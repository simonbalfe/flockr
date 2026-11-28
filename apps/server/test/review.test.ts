import { describe, expect, test } from "bun:test"
import { Channel, EventPage, Task } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]

const kindOf = (json: unknown) => z.object({ kind: z.string() }).parse(json).kind

async function claimedBy(call: Call, holder: string, title: string, channel = "backend"): Promise<Task> {
  const made = Task.parse((await call("simon", "POST", "/api/tasks", { channel, title })).json)
  return Task.parse((await call(holder, "POST", `/api/tasks/${made.id}/claim`)).json)
}

async function inReview(call: Call, options: { holder: string; reviewer?: string; title: string; channel?: string }): Promise<Task> {
  const task = await claimedBy(call, options.holder, options.title, options.channel)
  const sent = await call(options.holder, "POST", `/api/tasks/${task.id}/submit`, { epoch: task.claimEpoch, commit: "a1b2c3d", ...(options.reviewer ? { reviewer: options.reviewer } : {}) })
  expect(sent.status).toBe(200)
  return Task.parse(sent.json)
}

async function approvals(call: Call, id: number): Promise<number> {
  const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
  return page.events.filter((e) => e.type === "task.approved" && e.taskId === id).length
}

describe("review that holds (13a)", () => {
  test("only the named reviewer or a person approves, never the holder", async () => {
    const { call } = await freshBoard()
    const task = await inReview(call, { holder: "claude", reviewer: "codex", title: "Build the /users API" })
    expect(task).toMatchObject({ state: "review", reviewer: "codex", reviewCommit: "a1b2c3d" })
    const own = await call("claude", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })
    expect(own.status).toBe(403)
    expect((await call("claude", "POST", `/api/tasks/${task.id}/changes`, { note: "looks fine" })).status).toBe(403)
    expect((await call("gemini", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })).status).toBe(403)
    const approved = Task.parse((await call("codex", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })).json)
    expect(approved.state).toBe("done")

    const open = await inReview(call, { holder: "gemini", title: "Write the sign-up docs" })
    expect((await call("codex", "POST", `/api/tasks/${open.id}/approve`, {})).status).toBe(403)
    expect(Task.parse((await call("simon", "POST", `/api/tasks/${open.id}/approve`, {})).json).state).toBe("done")
  })

  test("a person who holds and submits a task cannot approve it", async () => {
    const { call } = await freshBoard()
    const task = await inReview(call, { holder: "simon", title: "Tidy the sign-up form" })
    const own = await call("simon", "POST", `/api/tasks/${task.id}/approve`, {})
    expect(own.status).toBe(403)
    expect(Task.parse((await call("tim", "POST", `/api/tasks/${task.id}/approve`, {})).json).state).toBe("done")
  })

  test("with a reviewer named the holder cannot mark the task done", async () => {
    const { call } = await freshBoard()
    const made = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "backend", title: "Ship the hero image", reviewer: "codex" })).json)
    expect(made.reviewer).toBe("codex")
    const claimed = Task.parse((await call("claude", "POST", `/api/tasks/${made.id}/claim`)).json)
    const done = await call("claude", "POST", `/api/tasks/${made.id}/complete`, { epoch: claimed.claimEpoch })
    expect(done.status).toBe(403)
    expect((await call("simon", "POST", `/api/tasks/${made.id}/complete`, {})).status).toBe(403)
    const sent = Task.parse((await call("claude", "POST", `/api/tasks/${made.id}/submit`, { epoch: claimed.claimEpoch })).json)
    expect(sent).toMatchObject({ state: "review", reviewer: "codex" })
  })

  test("an approval at an older commit is refused once a newer one lands", async () => {
    const { call } = await freshBoard()
    const task = await inReview(call, { holder: "claude", reviewer: "codex", title: "Build the /users API" })
    await call("claude", "POST", `/api/tasks/${task.id}/commits`, { sha: "e4f5a6b" })
    const stale = await call("codex", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })
    expect(stale.status).toBe(409)
    expect(kindOf(stale.json)).toBe("stale_review")
    const still = Task.parse((await call("codex", "GET", `/api/tasks/${task.id}`)).json)
    expect(still).toMatchObject({ state: "review", reviewCommit: "e4f5a6b" })
    expect(Task.parse((await call("codex", "POST", `/api/tasks/${task.id}/approve`, { commit: "e4f5a6b" })).json).state).toBe("done")
  })

  test("review caps: two open reviews per reviewer agent, two tasks in review per submitting agent", async () => {
    const { call } = await freshBoard()
    await inReview(call, { holder: "claude", reviewer: "codex", title: "First" })
    await inReview(call, { holder: "gemini", reviewer: "codex", title: "Second" })
    const third = await claimedBy(call, "lead", "Third")
    const full = await call("lead", "POST", `/api/tasks/${third.id}/submit`, { epoch: third.claimEpoch, reviewer: "codex" })
    expect(full.status).toBe(409)
    expect(kindOf(full.json)).toBe("review_full")
    expect(Task.parse((await call("lead", "GET", `/api/tasks/${third.id}`)).json).state).toBe("claimed")
    expect((await call("lead", "POST", `/api/tasks/${third.id}/submit`, { epoch: third.claimEpoch, reviewer: "simon" })).status).toBe(200)

    const more = await claimedBy(call, "claude", "Fourth")
    const crowded = await call("claude", "POST", `/api/tasks/${more.id}/submit`, { epoch: more.claimEpoch })
    expect(crowded.status).toBe(409)
    expect(kindOf(crowded.json)).toBe("review_full")
  })

  test("a reviewer must see the channel: an acme agent in a shared channel can review, a globex one cannot", async () => {
    const { call } = await freshBoard()
    await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
    await call("simon", "POST", "/api/orgs", { id: "globex", name: "Globex" })
    await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
    await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
    await call("simon", "POST", "/api/members", { name: "gus", kind: "person", org: "globex" })
    await call("simon", "POST", "/api/members", { name: "globex-bot", kind: "agent", org: "globex", owner: "gus" })
    await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
    for (const name of ["ana", "acme-bot"]) await call("simon", "PUT", `/api/channels/acme-site/members/${name}`)
    const task = await claimedBy(call, "claude", "Shrink the hero image", "acme-site")
    const outside = await call("claude", "POST", `/api/tasks/${task.id}/submit`, { epoch: task.claimEpoch, reviewer: "globex-bot" })
    expect(outside.status).toBe(400)
    const named = Task.parse((await call("claude", "POST", `/api/tasks/${task.id}/submit`, { epoch: task.claimEpoch, reviewer: "acme-bot" })).json)
    expect(named.reviewer).toBe("acme-bot")
    expect((await call("acme-bot", "POST", `/api/tasks/${task.id}/approve`, { commit: named.reviewCommit ?? undefined })).status).toBe(200)
  })

  test("a channel can make approval need a person; the reviewer agent may still ask for changes", async () => {
    const { call } = await freshBoard()
    expect((await call("claude", "PATCH", "/api/channels/backend", { reviewNeedsPerson: true })).status).toBe(403)
    const channel = Channel.parse((await call("simon", "PATCH", "/api/channels/backend", { reviewNeedsPerson: true })).json)
    expect(channel.reviewNeedsPerson).toBe(true)
    const task = await inReview(call, { holder: "claude", reviewer: "codex", title: "Build the /users API" })
    expect((await call("codex", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })).status).toBe(403)
    expect(Task.parse((await call("codex", "POST", `/api/tasks/${task.id}/changes`, { note: "Add a test" })).json).state).toBe("claimed")
    const back = Task.parse((await call("claude", "POST", `/api/tasks/${task.id}/submit`, { epoch: task.claimEpoch })).json)
    expect(back.reviewer).toBe("codex")
    expect(Task.parse((await call("simon", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })).json).state).toBe("done")
  })

  test("a retried approval at the same commit returns the task and writes one event", async () => {
    const { call } = await freshBoard()
    const task = await inReview(call, { holder: "claude", reviewer: "codex", title: "Build the /users API" })
    expect((await call("codex", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })).status).toBe(200)
    const again = await call("codex", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })
    expect(again.status).toBe(200)
    expect(Task.parse(again.json).state).toBe("done")
    expect(await approvals(call, task.id)).toBe(1)
    expect((await call("gemini", "POST", `/api/tasks/${task.id}/approve`, { commit: "a1b2c3d" })).status).toBe(409)
  })

  test("the holder or a person changes the reviewer; the reviewer cannot be the holder", async () => {
    const { call } = await freshBoard()
    const task = await inReview(call, { holder: "claude", title: "Build the /users API" })
    expect((await call("gemini", "PUT", `/api/tasks/${task.id}/reviewer`, { reviewer: "gemini" })).status).toBe(403)
    expect((await call("simon", "PUT", `/api/tasks/${task.id}/reviewer`, { reviewer: "claude" })).status).toBe(400)
    const set = Task.parse((await call("claude", "PUT", `/api/tasks/${task.id}/reviewer`, { reviewer: "codex" })).json)
    expect(set.reviewer).toBe("codex")
    const listed = z.array(Task).parse((await call("simon", "GET", "/api/tasks?reviewer=codex")).json)
    expect(listed.map((t) => t.id)).toEqual([task.id])
  })
})
