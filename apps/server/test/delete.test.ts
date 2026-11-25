import { describe, expect, test } from "bun:test"
import { DeletedMessage, ErrorBody, EventPage, FeedItem, PostMessageResult, Reply, Thread } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]

async function post(call: Call, who: string, text: string): Promise<string> {
  return PostMessageResult.parse((await call(who, "POST", "/api/channels/backend/messages", { text })).json).message.id
}

const feedOf = async (call: Call) => z.array(FeedItem).parse((await call("simon", "GET", "/api/channels/backend/messages")).json)
const eventsOf = async (call: Call) => EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)

describe("delete a message", () => {
  test("the author deletes it, and every read shows a tombstone without the text", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "claude", "secret plan")
    const res = await call("claude", "DELETE", `/api/messages/${id}`)
    expect(res.status).toBe(200)
    expect(DeletedMessage.parse(res.json)).toMatchObject({ id, channel: "backend", deletedBy: "claude" })
    const item = (await feedOf(call)).find((i) => i.id === id)
    expect(item).toMatchObject({ kind: "text", deleted: true, text: "" })
    const thread = Thread.parse((await call("simon", "GET", `/api/threads/${id}`)).json)
    expect(thread.root).toMatchObject({ deleted: true, text: "" })
    expect(JSON.stringify((await call("simon", "GET", `/api/channels/backend/messages`)).json)).not.toContain("secret plan")
  })

  test("a stranger agent gets 403 and the message stays", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "claude", "mine")
    const res = await call("gemini", "DELETE", `/api/messages/${id}`)
    expect(res.status).toBe(403)
    expect(ErrorBody.parse(res.json).kind).toBe("forbidden")
    expect((await feedOf(call)).find((i) => i.id === id)).toMatchObject({ deleted: false, text: "mine" })
    expect((await call("nobody", "DELETE", `/api/messages/${id}`)).status).toBe(403)
  })

  test("an agent cannot delete a person's message", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "simon", "from simon")
    expect((await call("claude", "DELETE", `/api/messages/${id}`)).status).toBe(403)
  })

  test("the agent's owner and any other person can delete the agent's message", async () => {
    const { call } = await freshBoard()
    const first = await post(call, "claude", "one")
    const second = await post(call, "claude", "two")
    expect((await call("simon", "DELETE", `/api/messages/${first}`)).status).toBe(200)
    expect((await call("tim", "DELETE", `/api/messages/${second}`)).status).toBe(200)
  })

  test("deleting twice writes one event and changes nothing the second time", async () => {
    const { call } = await freshBoard()
    const id = await post(call, "claude", "twice")
    const first = DeletedMessage.parse((await call("claude", "DELETE", `/api/messages/${id}`)).json)
    const headBefore = (await eventsOf(call)).head
    const second = await call("simon", "DELETE", `/api/messages/${id}`)
    expect(second.status).toBe(200)
    expect(DeletedMessage.parse(second.json)).toEqual(first)
    const page = await eventsOf(call)
    expect(page.head).toBe(headBefore)
    expect(page.events.filter((e) => e.type === "message.deleted")).toEqual([
      expect.objectContaining({ actor: "claude", messageId: id, channel: "backend", threadId: id }),
    ])
  })

  test("a task card and a system event are refused with 409, an unknown id is 404", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    await call("claude", "POST", "/api/tasks/806/complete", { epoch: 1 })
    const all = await Promise.all(["backend", "reviews", "errors"].map((c) => call("simon", "GET", `/api/channels/${c}/messages`)))
    const feed = all.flatMap((r) => z.array(FeedItem).parse(r.json))
    const card = feed.find((i) => i.kind === "task")
    const system = feed.find((i) => i.kind === "event")
    expect(card).toBeDefined()
    expect(system).toBeDefined()
    for (const item of [card, system]) {
      const res = await call("simon", "DELETE", `/api/messages/${item?.id}`)
      expect(res.status).toBe(409)
      expect(ErrorBody.parse(res.json).kind).toBe("wrong_state")
    }
    expect((await call("simon", "DELETE", "/api/messages/806")).status).toBe(409)
    expect((await call("simon", "DELETE", "/api/messages/m99999")).status).toBe(404)
  })

  test("the event sequence stays gapless and no event is removed", async () => {
    const { call } = await freshBoard()
    const before = (await eventsOf(call)).events
    const id = await post(call, "claude", "gapless")
    await call("claude", "DELETE", `/api/messages/${id}`)
    await post(call, "claude", "after")
    const page = await eventsOf(call)
    expect(page.events.map((e) => e.seq)).toEqual(Array.from({ length: page.head }, (_, i) => i + 1))
    expect(page.events.slice(0, before.length)).toEqual(before)
    expect(page.events.map((e) => e.type).slice(before.length)).toEqual(["message.posted", "message.deleted", "message.posted"])
  })

  test("a thread keeps its replies after its root is deleted, and a deleted reply is a tombstone", async () => {
    const { call } = await freshBoard()
    const root = await post(call, "claude", "root text")
    const keep = Reply.parse((await call("tim", "POST", `/api/threads/${root}/replies`, { text: "kept reply" })).json)
    const gone = Reply.parse((await call("tim", "POST", `/api/threads/${root}/replies`, { text: "removed reply" })).json)
    expect((await call("claude", "DELETE", `/api/messages/${root}`)).status).toBe(200)
    expect((await call("tim", "DELETE", `/api/messages/${gone.id}`)).status).toBe(200)
    const item = (await feedOf(call)).find((i) => i.id === root)
    expect(item).toMatchObject({ kind: "text", deleted: true, text: "", thread: { count: 2 } })
    const thread = Thread.parse((await call("simon", "GET", `/api/threads/${root}`)).json)
    expect(thread.root).toMatchObject({ deleted: true, text: "" })
    expect(thread.entries).toMatchObject([
      { id: keep.id, text: "kept reply", deleted: false },
      { id: gone.id, text: "", deleted: true },
    ])
    const events = (await eventsOf(call)).events.filter((e) => e.type === "message.deleted")
    expect(events.map((e) => e.threadId)).toEqual([root, root])
  })
})
