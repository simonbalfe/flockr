import { describe, expect, test } from "bun:test"
import { Channel, ErrorBody, EventPage, FeedItem, MessageState, MessageVersions, PostMessageResult, Reply, Task, Thread } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]

async function post(call: Call, who: string, text: string, labels: string[] = []): Promise<string> {
  return PostMessageResult.parse((await call(who, "POST", "/api/channels/backend/messages", { text, labels })).json).message.id
}

const replyTo = async (call: Call, who: string, id: string, text: string) => Reply.parse((await call(who, "POST", `/api/threads/${id}/replies`, { text })).json)
const feedOf = async (call: Call, query = "") => z.array(FeedItem).parse((await call("simon", "GET", `/api/channels/backend/messages${query}`)).json)
const eventsOf = async (call: Call) => EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
const versionsOf = async (call: Call, id: string) => MessageVersions.parse((await call("tim", "GET", `/api/messages/${id}/versions`)).json)

describe("edit a message", () => {
  test("only the author can change the text", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "claude", "first draft")
    for (const who of ["gemini", "simon", "tim", "nobody"]) {
      const res = await call(who, "PATCH", `/api/messages/${id}`, { text: "not yours" })
      expect(res.status).toBe(403)
    }
    expect((await feedOf(call)).find((i) => i.id === id)).toMatchObject({ text: "first draft", editedAt: null })
    const res = await call("claude", "PATCH", `/api/messages/${id}`, { text: "second draft" })
    expect(res.status).toBe(200)
    expect(MessageState.parse(res.json)).toMatchObject({ id, text: "second draft", version: 2 })
  })

  test("an edit is a new event, the old text stays readable and mentions are read again", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "simon", "ping @claude")
    const before = (await eventsOf(call)).events
    expect((await call("simon", "PATCH", `/api/messages/${id}`, { text: "ping @codex instead" })).status).toBe(200)
    expect((await call("simon", "PATCH", `/api/messages/${id}`, { text: "ping @codex instead" })).status).toBe(200)
    const page = await eventsOf(call)
    expect(page.events.slice(0, before.length)).toEqual(before)
    expect(page.events.slice(before.length)).toEqual([
      expect.objectContaining({ type: "message.edited", actor: "simon", messageId: id, data: { text: "ping @codex instead", mentions: ["codex"], version: 2 } }),
    ])
    const item = (await feedOf(call)).find((i) => i.id === id)
    expect(item).toMatchObject({ text: "ping @codex instead", mentions: ["codex"] })
    expect(item?.kind === "text" && item.editedAt).toBeTruthy()
    expect((await versionsOf(call, id)).versions).toMatchObject([
      { version: 1, text: "ping @claude", mentions: ["claude"], current: false },
      { version: 2, text: "ping @codex instead", mentions: ["codex"], current: true },
    ])
  })

  test("a deleted message cannot be edited and its versions are hidden", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "claude", "one")
    await call("claude", "PATCH", `/api/messages/${id}`, { text: "two" })
    await call("claude", "DELETE", `/api/messages/${id}`)
    expect((await call("claude", "PATCH", `/api/messages/${id}`, { text: "three" })).status).toBe(409)
    expect(await versionsOf(call, id)).toEqual({ id, deleted: true, versions: [] })
  })
})

describe("labels on messages", () => {
  test("reading a channel by label returns only what carries it", async () => {
    const { call } = await freshBoard()
    const tagged = await post(call, "simon", "please look", ["review", "review", "ui"])
    const plain = await post(call, "simon", "no label")
    expect((await feedOf(call)).find((i) => i.id === tagged)).toMatchObject({ labels: ["review", "ui"] })
    const task = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "backend", title: "Check the copy", labels: ["review"] })).json)
    const filtered = await feedOf(call, "?label=review")
    expect(filtered.map((i) => i.id)).toContain(tagged)
    expect(filtered.map((i) => i.id)).not.toContain(plain)
    expect(filtered.some((i) => i.kind === "task" && i.taskId === task.id)).toBe(true)
    expect(filtered.every((i) => (i.kind === "text" ? i.labels.includes("review") : i.kind === "task" || i.kind === "ask"))).toBe(true)
  })

  test("changing labels later is an event and moves the message in and out of the filter", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "claude", "done with the table")
    expect((await call("gemini", "PATCH", `/api/messages/${id}`, { labels: ["review"] })).status).toBe(403)
    expect(MessageState.parse((await call("simon", "PATCH", `/api/messages/${id}`, { labels: ["review"] })).json).labels).toEqual(["review"])
    expect((await feedOf(call, "?label=review")).map((i) => i.id)).toContain(id)
    await call("claude", "PATCH", `/api/messages/${id}`, { labels: [] })
    expect((await feedOf(call, "?label=review")).map((i) => i.id)).not.toContain(id)
    const labeled = (await eventsOf(call)).events.filter((e) => e.type === "message.labeled")
    expect(labeled.map((e) => [e.actor, e.data])).toEqual([
      ["simon", { labels: ["review"], added: ["review"], removed: [] }],
      ["claude", { labels: [], added: [], removed: ["review"] }],
    ])
  })
})

describe("sub-threads", () => {
  test("replying to a reply lands in its sub-thread, and a reply to that is flattened into the same sub-thread", async () => {
    const { call } = await freshBoard()
    const root = await post(call, "simon", "review the users table")
    const unread = async () => z.array(Channel).parse((await call("tim", "GET", "/api/channels")).json).find((c) => c.id === "backend")?.unread
    const before = await unread()
    const review = await replyTo(call, "claude", root, "Looks fine, one question on the index")
    const sub = await replyTo(call, "tim", review.id, "Which index?")
    const deeper = await replyTo(call, "claude", sub.id, "The email one")
    expect(review.replyTo).toBeNull()
    expect(sub.replyTo).toBe(review.id)
    expect(deeper.replyTo).toBe(review.id)
    const thread = Thread.parse((await call("simon", "GET", `/api/threads/${root}`)).json)
    expect(thread.entries.map((e) => [e.id, e.kind === "reply" ? e.replyTo : null])).toEqual([
      [review.id, null],
      [sub.id, review.id],
      [deeper.id, review.id],
    ])
    expect(await unread()).toBe(before)
    const events = (await eventsOf(call)).events.filter((e) => e.type === "reply.posted").slice(-2)
    expect(events.map((e) => [e.threadId, e.data.replyTo])).toEqual([
      [root, review.id],
      [root, review.id],
    ])
  })

  test("a sub-thread in a task thread stays in the task thread and checks the claim epoch", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    const review = Reply.parse((await call("claude", "POST", "/api/threads/806/replies", { text: "Ready for a look", epoch: 1 })).json)
    const sub = Reply.parse((await call("simon", "POST", `/api/threads/${review.id}/replies`, { text: "Why uuid keys?" })).json)
    expect(sub.replyTo).toBe(review.id)
    const stale = await call("claude", "POST", `/api/threads/${review.id}/replies`, { text: "Because", epoch: 0 })
    expect(stale.status).toBe(409)
    expect(ErrorBody.parse(stale.json).kind).toBe("stale_claim")
    const thread = Thread.parse((await call("simon", "GET", "/api/threads/806")).json)
    expect(thread.entries.filter((e) => e.kind === "reply").map((e) => e.id)).toEqual([review.id, sub.id])
  })
})
