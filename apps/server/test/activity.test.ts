import { describe, expect, test } from "bun:test"
import {
  Activity,
  ActivityEntry,
  ActivityEntryResult,
  ActivityPostedData,
  ActivityUpdatedData,
  applyActivityUpdates,
  EventPage,
  PostMessageResult,
  RunStopRequestedData,
  StopRunResult,
  Thread,
  ThreadQuestion,
  type ActivityState,
} from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

async function threadWithReply() {
  const board = await freshBoard()
  const posted = PostMessageResult.parse((await board.call("simon", "POST", "/api/channels/backend/messages", { text: "@claude add rate limiting" })).json)
  await board.call("claude", "POST", `/api/threads/${posted.message.id}/replies`, { text: "On it." })
  return { ...board, thread: posted.message.id }
}

const events = async (call: Awaited<ReturnType<typeof freshBoard>>["call"], since = 0) =>
  EventPage.parse((await call("simon", "GET", `/api/events?since=${since}&limit=1000`)).json)

const run = {
  title: "Add rate limiting",
  parts: [
    { type: "reasoning", id: "r1", text: "The limiter belongs in the API middleware." },
    { type: "plan", id: "plan", steps: [{ text: "Write the limiter", status: "doing" }, { text: "Run the tests", status: "pending" }] },
  ],
}

async function postRun(call: Awaited<ReturnType<typeof freshBoard>>["call"], thread: string) {
  const created = await call("claude", "POST", `/api/threads/${thread}/activity-entries`, run)
  expect(created.status).toBe(200)
  return ActivityEntryResult.parse(created.json).entry
}

const update = (call: Awaited<ReturnType<typeof freshBoard>>["call"], member: string, id: string, body: unknown) =>
  call(member, "POST", `/api/activity-entries/${id}/updates`, body)

describe("activity entries", () => {
  test("an entry is appended once and reads return its latest state", async () => {
    const { call, thread } = await threadWithReply()
    const entry = await postRun(call, thread)
    expect(entry).toMatchObject({ kind: "activity", who: "claude", threadId: thread, channel: "backend", status: "running", revision: 1 })
    expect(entry.parts.map((p) => p.id)).toEqual(["r1", "plan"])

    const steps = [
      { updates: [{ type: "part.set", part: { type: "terminal", id: "c1", command: "bun test" } }] },
      { updates: [{ type: "part.append", partId: "c1", text: "12 pass\n" }] },
      { updates: [{ type: "part.append", partId: "c1", text: "1 fail\n" }] },
      { updates: [{ type: "part.finished", partId: "c1", status: "error", exitCode: 1 }] },
    ]
    for (const body of steps) expect((await update(call, "claude", entry.id, body)).status).toBe(200)

    const read = ActivityEntry.parse((await call("simon", "GET", `/api/activity-entries/${entry.id}`)).json)
    expect(read.revision).toBe(5)
    expect(read.parts.find((p) => p.id === "c1")).toMatchObject({ type: "terminal", output: "12 pass\n1 fail\n", exitCode: 1, status: "error" })

    const threadRead = Thread.parse((await call("simon", "GET", `/api/threads/${thread}`)).json)
    expect(threadRead.entries.map((e) => e.kind)).toEqual(["reply", "activity"])
    expect(threadRead.entries.at(-1)).toEqual(read)
    expect(threadRead.root?.thread?.count).toBe(1)
  })

  test("every change is one event in order, and replaying the log rebuilds the latest state", async () => {
    const { call, thread } = await threadWithReply()
    const head = (await events(call)).head
    const entry = await postRun(call, thread)
    await update(call, "claude", entry.id, { updates: [{ type: "part.set", part: { type: "tool", id: "t1", name: "edit_file", input: { path: "src/limits.ts" } } }] })
    await update(call, "claude", entry.id, { updates: [{ type: "part.finished", partId: "t1", status: "ok", output: "Edited" }] })
    await update(call, "claude", entry.id, { updates: [{ type: "run.finished", status: "ok", title: "Added rate limiting" }] })

    const page = await events(call, head)
    const mine = page.events.filter((e) => e.messageId === entry.id)
    expect(mine.map((e) => e.type)).toEqual(["activity.posted", "activity.updated", "activity.updated", "activity.updated"])
    expect(mine.map((e) => e.seq)).toEqual([...mine.map((e) => e.seq)].sort((a, b) => a - b))
    expect(new Set(mine.map((e) => e.threadId))).toEqual(new Set([thread]))

    const [posted, ...updates] = mine
    const start = ActivityPostedData.parse(posted?.data).entry
    let state: ActivityState = { ...start, key: null }
    for (const event of updates) {
      const data = ActivityUpdatedData.parse(event.data)
      const next = applyActivityUpdates(state, data.updates, data.at)
      if (!next.ok) throw new Error(next.error)
      expect(next.state.revision).toBe(data.revision)
      state = next.state
    }
    const read = ActivityEntry.parse((await call("simon", "GET", `/api/activity-entries/${entry.id}`)).json)
    const { key: _key, ...replayed } = state
    expect({ ...read }).toMatchObject(replayed)
    expect(read).toMatchObject({ status: "ok", title: "Added rate limiting" })
    expect(read.parts.find((p) => p.id === "t1")).toMatchObject({ status: "ok", output: "Edited" })
  })

  test("only the author updates its entry", async () => {
    const { call, thread } = await threadWithReply()
    const entry = await postRun(call, thread)
    const body = { updates: [{ type: "part.append", partId: "r1", text: " more" }] }
    expect((await update(call, "codex", entry.id, body)).status).toBe(403)
    expect((await update(call, "simon", entry.id, body)).status).toBe(403)
    expect((await update(call, "claude", entry.id, body)).status).toBe(200)
  })

  test("a repeated create or update changes nothing twice", async () => {
    const { call, thread } = await threadWithReply()
    const first = ActivityEntryResult.parse((await call("claude", "POST", `/api/threads/${thread}/activity-entries`, { ...run, key: "run-1" })).json)
    const again = ActivityEntryResult.parse((await call("claude", "POST", `/api/threads/${thread}/activity-entries`, { ...run, key: "run-1" })).json)
    expect(again).toMatchObject({ applied: false, entry: { id: first.entry.id } })

    const body = { revision: 1, updates: [{ type: "part.append", partId: "r1", text: " Then test it." }] }
    expect(ActivityEntryResult.parse((await update(call, "claude", first.entry.id, body)).json).applied).toBe(true)
    const head = (await events(call)).head
    const retried = ActivityEntryResult.parse((await update(call, "claude", first.entry.id, body)).json)
    expect(retried.applied).toBe(false)
    expect(retried.entry.parts.find((p) => p.id === "r1")).toMatchObject({ text: "The limiter belongs in the API middleware. Then test it." })
    expect((await events(call)).head).toBe(head)
    expect((await update(call, "claude", first.entry.id, { revision: 9, updates: body.updates })).status).toBe(400)
  })

  test("a finished run takes no more updates, and bad updates are refused", async () => {
    const { call, thread } = await threadWithReply()
    const entry = await postRun(call, thread)
    expect((await update(call, "claude", entry.id, { updates: [{ type: "part.append", partId: "nope", text: "x" }] })).status).toBe(400)
    expect((await update(call, "claude", entry.id, { updates: [{ type: "part.append", partId: "plan", text: "x" }] })).status).toBe(400)
    expect((await update(call, "claude", entry.id, { updates: [{ type: "run.finished", status: "error" }] })).status).toBe(200)
    expect((await update(call, "claude", entry.id, { updates: [{ type: "part.set", part: { type: "reasoning", text: "late" } }] })).status).toBe(409)
    const read = ActivityEntry.parse((await call("simon", "GET", `/api/activity-entries/${entry.id}`)).json)
    expect(read.parts.find((p) => p.id === "r1")).toMatchObject({ status: "error" })
  })

  test("a running entry shows its author as working until the run finishes", async () => {
    const { call, thread } = await threadWithReply()
    const entry = await postRun(call, thread)
    const working = z.array(Activity).parse((await call("simon", "GET", "/api/activity")).json)
    expect(working.map((a) => [a.member, a.threadId])).toEqual([["claude", thread]])
    await update(call, "claude", entry.id, { updates: [{ type: "run.finished", status: "ok" }] })
    expect(z.array(Activity).parse((await call("simon", "GET", "/api/activity")).json)).toEqual([])
  })

  test("entries live in task threads too", async () => {
    const { call } = await freshBoard()
    const created = ActivityEntryResult.parse((await call("claude", "POST", "/api/threads/806/activity-entries", run)).json)
    expect(created.entry.threadId).toBe("806")
    const read = Thread.parse((await call("simon", "GET", "/api/threads/806")).json)
    expect(read.entries.at(-1)?.kind).toBe("activity")
  })
})

describe("an agent's recent runs", () => {
  test("they list only that agent's entries across its threads, newest first, up to the limit", async () => {
    const { call, thread } = await threadWithReply()
    const other = PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "@claude and the docs" })).json).message.id
    const first = ActivityEntryResult.parse((await call("claude", "POST", `/api/threads/${thread}/activity-entries`, { title: "Rate limiting" })).json).entry
    await call("simon", "POST", `/api/threads/${thread}/activity-entries`, { title: "Not claude's" })
    const second = ActivityEntryResult.parse((await call("claude", "POST", `/api/threads/${other}/activity-entries`, { title: "Docs" })).json).entry
    const all = z.array(ActivityEntry).parse((await call("simon", "GET", "/api/agents/claude/activity")).json)
    expect(all.map((e) => [e.id, e.threadId, e.who])).toEqual([
      [second.id, other, "claude"],
      [first.id, thread, "claude"],
    ])
    const one = z.array(ActivityEntry).parse((await call("simon", "GET", "/api/agents/claude/activity?limit=1")).json)
    expect(one.map((e) => e.id)).toEqual([second.id])
    expect((await call("simon", "GET", "/api/agents/nobody/activity")).status).toBe(404)
  })
})

describe("stop a run", () => {
  test("a person asks a working member to stop: one run.stop_requested event, entries marked, repeat changes nothing", async () => {
    const { call, thread } = await threadWithReply()
    const entry = await postRun(call, thread)
    const head = (await events(call)).head
    const stopped = StopRunResult.parse((await call("simon", "POST", `/api/threads/${thread}/stop`, { reason: "Wrong approach" })).json)
    expect(stopped.requests).toEqual([expect.objectContaining({ member: "claude", threadId: thread, entryIds: [entry.id], requestedBy: "simon", repeated: false })])
    const page = await events(call, head)
    expect(page.events.map((e) => e.type)).toEqual(["run.stop_requested"])
    expect(page.events[0]).toMatchObject({ actor: "simon", threadId: thread, channel: "backend", messageId: entry.id })
    expect(RunStopRequestedData.parse(page.events[0]?.data)).toMatchObject({ member: "claude", reason: "Wrong approach", entryIds: [entry.id] })
    const read = ActivityEntry.parse((await call("simon", "GET", `/api/activity-entries/${entry.id}`)).json)
    expect(read.stopRequestedAt).not.toBeNull()
    expect(read.status).toBe("running")

    const again = StopRunResult.parse((await call("simon", "POST", `/api/threads/${thread}/stop`, {})).json)
    expect(again.requests[0]?.repeated).toBe(true)
    expect((await events(call)).head).toBe(page.head)

    expect((await update(call, "claude", entry.id, { updates: [{ type: "run.finished", status: "stopped" }] })).status).toBe(200)
    expect((await call("simon", "POST", `/api/threads/${thread}/stop`, {})).status).toBe(409)
  })

  test("only a person, the member itself or its owner may stop a run", async () => {
    const { call, thread } = await threadWithReply()
    await postRun(call, thread)
    expect((await call("gemini", "POST", `/api/threads/${thread}/stop`, { member: "claude" })).status).toBe(403)
    expect((await call("codex", "POST", `/api/threads/${thread}/stop`, { member: "claude" })).status).toBe(403)
    expect((await call("claude", "POST", `/api/threads/${thread}/stop`, { member: "claude" })).status).toBe(200)
  })
})

describe("permission questions", () => {
  test("a thread question carries the exact action being approved", async () => {
    const { call, thread } = await threadWithReply()
    const action = { tool: "edit_file", path: "src/limits.ts", diff: "--- a/src/limits.ts\n+++ b/src/limits.ts\n@@ -1 +1 @@\n-export const limit = 10\n+export const limit = 100\n" }
    const asked = ThreadQuestion.parse((await call("claude", "POST", `/api/threads/${thread}/ask`, { text: "Edit src/limits.ts?", options: ["Allow once", "Deny"], action })).json)
    expect(asked.question.action).toEqual(action)
    const read = Thread.parse((await call("simon", "GET", `/api/threads/${thread}`)).json)
    expect(read.entries.at(-1)).toMatchObject({ kind: "question", question: { action } })
  })
})
