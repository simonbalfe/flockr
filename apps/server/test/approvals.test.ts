import { describe, expect, test } from "bun:test"
import { actionKindRules, actionKinds, ApprovalCheck, ApprovalRules, approvalOptions, ErrorBody, Inbox, Job, Routine, routineActor, ThreadQuestion, verdictRank } from "@flockr/contracts"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { drainJobs } from "../src/board/drain"
import type { Database } from "../src/db/client"
import { approvalRules, messages } from "../src/db/schema"
import { freshBoard } from "./harness"

type Board = Awaited<ReturnType<typeof freshBoard>>

const floorAsk = actionKinds.filter((kind) => actionKindRules[kind].floor === "ask")

async function watcher(board: Board, text = "Seen it"): Promise<Routine> {
  const made = await board.call("simon", "POST", "/api/routines", {
    name: "Echo backend",
    channel: "backend",
    trigger: { kind: "event", eventType: "message.posted" },
    action: { kind: "post", text },
  })
  expect(made.status).toBe(200)
  const routine = Routine.parse(made.json)
  expect((await board.call("simon", "POST", `/api/routines/${routine.id}/on`)).status).toBe(200)
  return routine
}

const setRule = (board: Board, body: Record<string, unknown>, member = "simon") => board.call(member, "PUT", "/api/approval-rules", body)

const check = async (board: Board, kind: string, channel?: string) =>
  ApprovalCheck.parse((await board.call("claude", "GET", `/api/approval-rules/check?kind=${kind}${channel ? `&channel=${channel}` : ""}`)).json)

const jobsOf = async (board: Board, id: number) => z.array(Job).parse((await board.call("simon", "GET", `/api/routines/${id}/jobs?limit=50`)).json)

const postsBy = async (db: Database, who: string, text: string) =>
  db
    .select()
    .from(messages)
    .where(and(eq(messages.who, who), eq(messages.kind, "text"), eq(messages.body, text)))

const openApproval = async (board: Board): Promise<ThreadQuestion> => {
  const inbox = Inbox.parse((await board.call("simon", "GET", "/api/inbox")).json)
  const asked = inbox.threadQuestions.find((q) => q.who === routineActor)
  if (!asked) throw new Error("No approval question in the inbox")
  return asked
}

async function waitingJob(board: Board): Promise<{ routine: Routine; question: ThreadQuestion }> {
  expect((await setRule(board, { kind: "post", channel: "backend", verdict: "ask" })).status).toBe(200)
  const routine = await watcher(board)
  expect((await board.call("simon", "POST", "/api/channels/backend/messages", { text: "hello" })).status).toBe(200)
  await drainJobs(board.db)
  const [job] = await jobsOf(board, routine.id)
  expect(job?.state).toBe("waiting")
  const question = await openApproval(board)
  expect(question.question.options).toEqual([approvalOptions.allow, approvalOptions.deny])
  expect(question.question.text).toBe("Routine Echo backend wants to post a message?")
  expect(question.channel).toBe("backend")
  return { routine, question }
}

describe("the floor", () => {
  test("no rule can make spending money or changing prod looser than ask, board-wide or in a channel", async () => {
    const board = await freshBoard()
    expect(floorAsk).toEqual(["spend", "prod"])
    for (const kind of floorAsk) {
      for (const channel of [null, "backend"]) {
        const refused = await setRule(board, { kind, channel, verdict: "allow" })
        expect(refused.status).toBe(400)
        expect(ErrorBody.parse(refused.json).kind).toBe("invalid")
      }
      expect(await check(board, kind, "backend")).toMatchObject({ verdict: "ask", source: "default", floor: "ask" })
      expect((await setRule(board, { kind, channel: "backend", verdict: "block" })).status).toBe(200)
      expect((await check(board, kind, "backend")).verdict).toBe("block")
      await board.db.insert(approvalRules).values({ kind, channel: "platform", verdict: "allow", setBy: "simon" })
      expect(await check(board, kind, "platform")).toMatchObject({ verdict: "ask", source: "channel" })
    }
    const listed = ApprovalRules.parse((await board.call("tim", "GET", "/api/approval-rules")).json)
    for (const info of listed.kinds) expect(verdictRank[info.default]).toBeGreaterThanOrEqual(verdictRank[info.floor])
  })

  test("only a person sets or clears a rule; a channel rule beats the board rule and clearing restores it", async () => {
    const board = await freshBoard()
    const refused = await setRule(board, { kind: "command", channel: "backend", verdict: "allow" }, "claude")
    expect(refused.status).toBe(403)
    expect((await board.call("claude", "DELETE", "/api/approval-rules?kind=command")).status).toBe(403)
    expect(await check(board, "command", "backend")).toMatchObject({ verdict: "ask", source: "default" })
    expect((await setRule(board, { kind: "command", channel: null, verdict: "block" })).status).toBe(200)
    expect((await setRule(board, { kind: "command", channel: "backend", verdict: "allow" })).status).toBe(200)
    expect(await check(board, "command", "backend")).toMatchObject({ verdict: "allow", source: "channel" })
    expect(await check(board, "command", "platform")).toMatchObject({ verdict: "block", source: "board" })
    const cleared = await board.call("simon", "DELETE", "/api/approval-rules?kind=command&channel=backend")
    expect(cleared.json).toMatchObject({ cleared: true })
    expect((await board.call("simon", "DELETE", "/api/approval-rules?kind=command&channel=backend")).json).toMatchObject({ cleared: false })
    expect(await check(board, "command", "backend")).toMatchObject({ verdict: "block", source: "board" })
  })
})

describe("a job waiting on approval", () => {
  test("it runs only after Allow once, and only once", async () => {
    const board = await freshBoard()
    const { routine, question } = await waitingJob(board)
    await drainJobs(board.db, { now: new Date(Date.now() + 3_600_000) })
    expect(await postsBy(board.db, routineActor, "Seen it")).toEqual([])
    expect((await board.call("claude", "POST", `/api/threads/${question.threadId}/answer`, { option: approvalOptions.allow })).status).toBe(403)
    expect((await board.call("simon", "POST", `/api/threads/${question.threadId}/answer`, { option: approvalOptions.allow })).status).toBe(200)
    expect((await jobsOf(board, routine.id))[0]?.state).toBe("queued")
    await drainJobs(board.db)
    await drainJobs(board.db)
    expect((await jobsOf(board, routine.id))[0]?.state).toBe("done")
    expect(await postsBy(board.db, routineActor, "Seen it")).toHaveLength(1)
    expect((await board.call("simon", "POST", `/api/threads/${question.threadId}/answer`, { option: approvalOptions.allow })).status).toBe(400)
    await drainJobs(board.db)
    expect(await postsBy(board.db, routineActor, "Seen it")).toHaveLength(1)
  })

  test("Deny skips it with the reason and it never runs", async () => {
    const board = await freshBoard()
    const { routine, question } = await waitingJob(board)
    expect((await board.call("simon", "POST", `/api/threads/${question.threadId}/answer`, { option: approvalOptions.deny })).status).toBe(200)
    const [job] = await jobsOf(board, routine.id)
    expect(job).toMatchObject({ state: "skipped", result: "Denied by simon" })
    await drainJobs(board.db, { now: new Date(Date.now() + 86_400_000) })
    expect(await postsBy(board.db, routineActor, "Seen it")).toEqual([])
    expect((await jobsOf(board, routine.id))[0]?.state).toBe("skipped")
  })

  test("block skips it straight away with the reason, and asks nobody", async () => {
    const board = await freshBoard()
    expect((await setRule(board, { kind: "post", channel: null, verdict: "block" })).status).toBe(200)
    const routine = await watcher(board)
    expect((await board.call("simon", "POST", "/api/channels/backend/messages", { text: "hello" })).status).toBe(200)
    await drainJobs(board.db)
    const [job] = await jobsOf(board, routine.id)
    expect(job?.state).toBe("skipped")
    expect(job?.result).toContain("block")
    expect(await postsBy(board.db, routineActor, "Seen it")).toEqual([])
    const inbox = Inbox.parse((await board.call("simon", "GET", "/api/inbox")).json)
    expect(inbox.threadQuestions.filter((q) => q.who === routineActor)).toEqual([])
  })
})
