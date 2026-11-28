import { describe, expect, test } from "bun:test"
import { authorizationHeader, bearerAuth, Channel, CreatedKey, Draft, EventPage, MyThread, PostMessageResult, SavedItem, SavedState, SaveDraftResult, SentItem } from "@flockr/contracts"
import { z } from "zod"
import { createApp } from "../src/app"
import { eventsSince } from "../src/board/events"
import { viewerOf } from "../src/board/visibility"
import { createKey } from "../src/board/keys"
import { logEmail } from "../src/email/log"
import { freshBoard } from "./harness"

const Channels = z.array(Channel)

async function directBoard() {
  const board = await freshBoard()
  const dm = Channel.parse((await board.call("simon", "POST", "/api/dms", { with: "claude" })).json)
  const posted = PostMessageResult.parse((await board.call("simon", "POST", `/api/channels/${dm.id}/messages`, { text: "check the zeppelin" })).json)
  return { ...board, dm, posted }
}

describe("direct messages", () => {
  test("opening a conversation twice, from either side, gives the same one", async () => {
    const { call, dm } = await directBoard()
    expect(dm).toMatchObject({ kind: "dm", members: ["claude", "simon"] })
    expect(Channel.parse((await call("simon", "POST", "/api/dms", { with: "claude" })).json).id).toBe(dm.id)
    expect(Channel.parse((await call("claude", "POST", "/api/dms", { with: "simon" })).json).id).toBe(dm.id)
    expect((await call("claude", "POST", "/api/dms", { with: "codex" })).status).toBe(400)
    expect((await call("simon", "POST", "/api/dms", { with: "simon" })).status).toBe(400)
  })

  test("only the two members read it, post in it, see it listed, find it or see its events", async () => {
    const { call, dm, posted } = await directBoard()
    const text = `/api/channels/${dm.id}/messages`
    expect((await call("claude", "GET", text)).status).toBe(200)
    for (const outsider of ["tim", "codex"]) {
      expect((await call(outsider, "GET", text)).status).toBe(403)
      expect((await call(outsider, "POST", text, { text: "hi" })).status).toBe(403)
      expect((await call(outsider, "GET", `/api/threads/${posted.message.id}`)).status).toBe(403)
      expect((await call(outsider, "POST", `/api/threads/${posted.message.id}/replies`, { text: "hi" })).status).toBe(403)
      expect((await call(outsider, "PUT", `/api/messages/${posted.message.id}/saved`)).status).toBe(403)
      expect((await call(outsider, "PUT", "/api/me/drafts", { kind: "channel", target: dm.id, text: "x" })).status).toBe(403)
      expect(Channels.parse((await call(outsider, "GET", "/api/channels")).json).map((c) => c.id)).not.toContain(dm.id)
      const hits = z.object({ hits: z.array(z.unknown()) }).parse((await call(outsider, "GET", "/api/search?q=zeppelin")).json)
      expect(hits.hits).toEqual([])
      const events = EventPage.parse((await call(outsider, "GET", "/api/events?since=0&limit=1000")).json)
      expect(events.events.filter((e) => e.channel === dm.id)).toEqual([])
    }
    expect(Channels.parse((await call("claude", "GET", "/api/channels")).json).map((c) => c.id)).toContain(dm.id)
    expect(EventPage.parse((await call("claude", "GET", "/api/events?since=0&limit=1000")).json).events.filter((e) => e.channel === dm.id).length).toBeGreaterThan(1)
  })

  test("a key limited to other channels cannot open, list or read it", async () => {
    const { connection, dm } = await directBoard()
    const app = createApp(connection.db, { auth: { mode: "on", people: new Map(), secret: "test-secret-for-the-navigation-tests-only", baseURL: "http://localhost", email: logEmail(() => undefined) } })
    const make = async (member: string, channels: string[] | null) => CreatedKey.parse(await createKey(connection.db, "simon", { member, channels })).secret
    const ask = async (key: string, method: string, path: string, body?: unknown) => {
      const response = await app.request(path, {
        method,
        headers: { origin: "http://localhost", [authorizationHeader]: bearerAuth(key), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: response.status, json: await response.json() }
    }
    const narrow = await make("simon", ["platform"])
    expect((await ask(narrow, "GET", `/api/channels/${dm.id}/messages`)).status).toBe(403)
    expect((await ask(narrow, "POST", "/api/dms", { with: "claude" })).status).toBe(403)
    expect((await ask(narrow, "GET", "/api/me/threads")).status).toBe(403)
    expect(Channels.parse((await ask(narrow, "GET", "/api/channels")).json).map((c) => c.id)).not.toContain(dm.id)
    const wide = await make("simon", null)
    expect((await ask(wide, "GET", `/api/channels/${dm.id}/messages`)).status).toBe(200)
    const other = await make("tim", null)
    expect((await ask(other, "GET", `/api/channels/${dm.id}/messages`)).status).toBe(403)
  })

  test("every message in it is addressed to the other member, so an agent wakes without an @mention", async () => {
    const { call, dm, posted } = await directBoard()
    expect(posted.message.mentions).toEqual(["claude"])
    const reply = await call("simon", "POST", `/api/threads/${posted.message.id}/replies`, { text: "and the tests?" })
    expect(reply.status).toBe(200)
    const events = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).events.filter((e) => e.channel === dm.id)
    expect(events.map((e) => e.type)).toEqual(["channel.created", "message.posted", "reply.posted"])
    expect(events[1]?.data).toMatchObject({ mentions: ["claude"], direct: true })
    expect(events[2]?.data).toMatchObject({ mentions: ["claude"], direct: true })
    const open = await call("simon", "POST", "/api/channels/backend/messages", { text: "plain" })
    expect(PostMessageResult.parse(open.json).message.mentions).toEqual([])
  })
})

describe("the live feed", () => {
  test("shows that something happened in a direct conversation, never what was said", async () => {
    const { db, call, dm, posted } = await directBoard()
    await call("simon", "PATCH", `/api/messages/${posted.message.id}`, { text: "a secret edit" })
    const seen = (await eventsSince(db, 0, 1000, { kind: "live", viewer: viewerOf("tim") })).filter((e) => e.channel === dm.id)
    expect(seen.map((e) => e.type)).toEqual(["channel.created", "message.posted", "message.edited"])
    expect(JSON.stringify(seen)).not.toContain("secret")
    expect(seen[1]?.data).toEqual({ mentions: ["claude"], direct: true })
  })
})

describe("saved items", () => {
  test("saving and unsaving can be repeated, and each real change is one event", async () => {
    const { call, dm, posted } = await directBoard()
    const id = posted.message.id
    expect(SavedState.parse((await call("simon", "PUT", `/api/messages/${id}/saved`)).json)).toEqual({ id, saved: true })
    await call("simon", "PUT", `/api/messages/${id}/saved`)
    const saved = z.array(SavedItem).parse((await call("simon", "GET", "/api/me/saved")).json)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ id, channel: dm.id, who: "simon", text: "check the zeppelin", deleted: false })
    expect(z.array(SavedItem).parse((await call("claude", "GET", "/api/me/saved")).json)).toEqual([])
    await call("simon", "DELETE", `/api/messages/${id}/saved`)
    await call("simon", "DELETE", `/api/messages/${id}/saved`)
    expect(z.array(SavedItem).parse((await call("simon", "GET", "/api/me/saved")).json)).toEqual([])
    const types = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).events.map((e) => e.type)
    expect(types.filter((t) => t === "message.saved")).toHaveLength(1)
    expect(types.filter((t) => t === "message.unsaved")).toHaveLength(1)
    expect((await call("simon", "PUT", "/api/messages/806/saved")).status).toBe(400)
  })
})

describe("drafts and sent", () => {
  test("a draft is kept per member and place, replaced as you type, and cleared when the message is sent", async () => {
    const { call } = await freshBoard()
    const root = PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "root" })).json).message.id
    const typed = SaveDraftResult.parse((await call("simon", "PUT", "/api/me/drafts", { kind: "channel", target: "backend", text: "half a thou" })).json)
    expect(typed.draft).toMatchObject({ kind: "channel", target: "backend", channel: "backend", text: "half a thou" })
    await call("simon", "PUT", "/api/me/drafts", { kind: "channel", target: "backend", text: "half a thought" })
    await call("simon", "PUT", "/api/me/drafts", { kind: "thread", target: root, text: "a reply in progress" })
    await call("tim", "PUT", "/api/me/drafts", { kind: "channel", target: "backend", text: "tim's" })
    const mine = z.array(Draft).parse((await call("simon", "GET", "/api/me/drafts")).json)
    expect(mine.map((d) => `${d.kind}:${d.target}:${d.text}`).sort()).toEqual([`channel:backend:half a thought`, `thread:${root}:a reply in progress`].sort())
    await call("simon", "POST", "/api/channels/backend/messages", { text: "half a thought" })
    await call("simon", "POST", `/api/threads/${root}/replies`, { text: "a reply in progress" })
    expect(z.array(Draft).parse((await call("simon", "GET", "/api/me/drafts")).json)).toEqual([])
    expect(z.array(Draft).parse((await call("tim", "GET", "/api/me/drafts")).json)).toHaveLength(1)
    await call("tim", "PUT", "/api/me/drafts", { kind: "channel", target: "backend", text: "  " })
    expect(z.array(Draft).parse((await call("tim", "GET", "/api/me/drafts")).json)).toEqual([])
    expect(EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).events.some((e) => e.type.startsWith("draft"))).toBe(false)
  })

  test("sent lists your own messages and replies, newest first", async () => {
    const { call } = await freshBoard()
    const root = PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "first" })).json).message.id
    await call("claude", "POST", `/api/threads/${root}/replies`, { text: "not mine" })
    await call("simon", "POST", `/api/threads/${root}/replies`, { text: "second" })
    const sent = z.array(SentItem).parse((await call("simon", "GET", "/api/me/sent")).json)
    expect(sent.slice(0, 2).map((s) => [s.kind, s.text])).toEqual([
      ["reply", "second"],
      ["message", "first"],
    ])
    expect(sent.every((s) => s.threadId.length > 0)).toBe(true)
  })
})

describe("threads", () => {
  test("lists threads you started or replied in, newest activity first, with replies from others as unread", async () => {
    const { call } = await freshBoard()
    const mine = PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "I started this" })).json).message.id
    const theirs = PostMessageResult.parse((await call("claude", "POST", "/api/channels/backend/messages", { text: "claude started this" })).json).message.id
    PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "nobody replied here" })).json)
    await call("simon", "POST", `/api/threads/${theirs}/replies`, { text: "I joined" })
    await call("claude", "POST", `/api/threads/${mine}/replies`, { text: "good point" })
    await call("claude", "POST", `/api/threads/${theirs}/replies`, { text: "welcome" })
    const threads = z.array(MyThread).parse((await call("simon", "GET", "/api/me/threads")).json)
    expect(threads.slice(0, 2).map((t) => t.threadId)).toEqual([theirs, mine])
    expect(threads[0]).toMatchObject({ title: "claude started this", replies: 2, lastWho: "claude", lastText: "welcome", unread: 1 })
    expect(threads[1]).toMatchObject({ title: "I started this", startedBy: "simon", replies: 1, unread: 1 })
    await call("simon", "POST", `/api/threads/${mine}/replies`, { text: "thanks" })
    const after = z.array(MyThread).parse((await call("simon", "GET", "/api/me/threads")).json)
    expect(after[0]).toMatchObject({ threadId: mine, unread: 0 })
    expect(z.array(MyThread).parse((await call("tim", "GET", "/api/me/threads")).json).map((t) => t.threadId)).not.toContain(mine)
  })
})
