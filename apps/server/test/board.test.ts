import { describe, expect, test } from "bun:test"
import { Agent, AgentDetail, Channel, EventPage, FeedItem, PostMessageResult, Task } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

describe("board reads and writes", () => {
  test("channels carry per-member unread counts and marking read clears them", async () => {
    const { call } = await freshBoard()
    const before = z.array(Channel).parse((await call("simon", "GET", "/api/channels")).json)
    expect(before.find((c) => c.id === "reviews")?.unread).toBe(1)
    await call("simon", "POST", "/api/channels/reviews/read")
    const after = z.array(Channel).parse((await call("simon", "GET", "/api/channels")).json)
    expect(after.find((c) => c.id === "reviews")?.unread).toBe(0)
  })

  test("a mention records who it names and makes no task", async () => {
    const { call } = await freshBoard()
    const before = z.array(Task).parse((await call("simon", "GET", "/api/tasks")).json).length
    const posted = PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "@claude and @nobody, add rate limiting to sign-up (mail@claude.dev)" })).json)
    expect(posted.message.mentions).toEqual(["claude"])
    expect(posted).not.toHaveProperty("task")
    expect(z.array(Task).parse((await call("simon", "GET", "/api/tasks")).json).length).toBe(before)
    const feed = z.array(FeedItem).parse((await call("simon", "GET", "/api/channels/backend/messages")).json)
    expect(feed.at(-1)).toMatchObject({ kind: "text", id: posted.message.id, mentions: ["claude"] })
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.at(-1)).toMatchObject({ type: "message.posted", messageId: posted.message.id, data: { mentions: ["claude"] } })
  })

  test("any message thread can be replied to and made into a task", async () => {
    const { call } = await freshBoard()
    const feed = z.array(FeedItem).parse((await call("simon", "GET", "/api/channels/backend/messages")).json)
    const dana = feed.find((i) => i.kind === "text" && i.id !== feed[0]?.id && i.thread !== null)
    const threadId = dana?.kind === "text" ? (dana.threadId ?? "") : ""
    expect((await call("tim", "POST", `/api/threads/${threadId}/replies`, { text: "Adding it after #812." })).status).toBe(200)
    const made = Task.parse((await call("simon", "POST", `/api/threads/${threadId}/task`)).json)
    expect(made.replyCount).toBeGreaterThan(0)
    expect((await call("simon", "GET", `/api/threads/${made.id}`)).status).toBe(200)
  })

  test("review: approve finishes the task, ask for changes returns it to its holder", async () => {
    const { call } = await freshBoard()
    const changed = Task.parse((await call("simon", "POST", "/api/tasks/816/changes", { note: "Add a test" })).json)
    expect(changed).toMatchObject({ state: "claimed", holder: "claude" })
    await call("claude", "POST", "/api/tasks/816/submit", { commit: "e4f5a6b" })
    const approved = Task.parse((await call("simon", "POST", "/api/tasks/816/approve")).json)
    expect(approved).toMatchObject({ state: "done", commit: "e4f5a6b" })
  })

  test("block, unblock, fail and unknown members", async () => {
    const { call } = await freshBoard()
    expect(Task.parse((await call("simon", "POST", "/api/tasks/806/block", { reason: "Waiting on design review" })).json).state).toBe("blocked")
    expect(Task.parse((await call("simon", "POST", "/api/tasks/806/unblock")).json).state).toBe("ready")
    await call("codex", "POST", "/api/tasks/806/claim")
    const failed = Task.parse((await call("codex", "POST", "/api/tasks/806/fail", { reason: "No access to the schema repo", epoch: 1 })).json)
    expect(failed).toMatchObject({ state: "blocked", holder: null })
    expect((await call("stranger", "POST", "/api/tasks/claim", {})).status).toBe(403)
    expect((await call("simon", "POST", "/api/members", { name: "stranger", owner: "simon" })).status).toBe(200)
    expect((await call("stranger", "POST", "/api/tasks/claim", {})).status).toBe(200)
  })

  test("agents show what they are working on", async () => {
    const { call } = await freshBoard()
    const agents = z.array(Agent).parse((await call("simon", "GET", "/api/agents")).json)
    expect(agents.find((a) => a.name === "claude")).toMatchObject({ state: "working", taskId: 803 })
    const detail = AgentDetail.parse((await call("simon", "GET", "/api/agents/gemini")).json)
    expect(detail.tasks.map((t) => t.id)).toEqual([822])
  })
})
