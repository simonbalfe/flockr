import { describe, expect, test } from "bun:test"
import { EventPage, FileContent, FileRef, PostMessageResult, Reaction, Reply, Thread, memberHeader } from "@flockr/contracts"
import { z } from "zod"
import { createApp } from "../src/app"
import { memoryStore } from "../src/storage/memory"
import { freshBoard } from "./harness"

async function boardWithFiles() {
  const board = await freshBoard()
  const app = createApp(board.db, { objects: memoryStore() })
  const call = async (member: string, method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { [memberHeader]: member, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const type = response.headers.get("content-type") ?? ""
    return { status: response.status, json: type.includes("json") ? ((await response.json()) as unknown) : null, bytes: type.includes("json") ? null : new Uint8Array(await response.arrayBuffer()), type }
  }
  await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
  await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
  await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
  await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
  await call("simon", "PUT", "/api/channels/acme-site/members/acme-bot")
  return { ...board, call }
}

const hello = btoa("hello hero")

describe("reactions and files (13g)", () => {
  test("a reaction is an event, shows on the message, and repeating it changes nothing", async () => {
    const { call } = await boardWithFiles()
    const posted = PostMessageResult.parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "Plan is in the doc" })).json).message
    const first = z.array(Reaction).parse((await call("claude", "PUT", `/api/messages/${posted.id}/reactions/eyes`)).json)
    expect(first).toEqual([{ reaction: "eyes", members: ["claude"] }])
    await call("claude", "PUT", `/api/messages/${posted.id}/reactions/eyes`)
    await call("codex", "PUT", `/api/messages/${posted.id}/reactions/eyes`)
    const thread = Thread.parse((await call("simon", "GET", `/api/threads/${posted.id}`)).json)
    expect(thread.root?.reactions).toEqual([{ reaction: "eyes", members: ["claude", "codex"] }])
    await call("claude", "DELETE", `/api/messages/${posted.id}/reactions/eyes`)
    await call("claude", "DELETE", `/api/messages/${posted.id}/reactions/eyes`)
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.filter((e) => e.type.startsWith("reaction.")).map((e) => [e.type, e.actor])).toEqual([
      ["reaction.added", "claude"],
      ["reaction.added", "codex"],
      ["reaction.removed", "claude"],
    ])
    expect((await call("claude", "PUT", `/api/messages/${posted.id}/reactions/party`)).status).toBe(400)
  })

  test("a file uploads to a channel, attaches to a reply and downloads only for those who see the channel", async () => {
    const { call } = await boardWithFiles()
    const file = FileRef.parse((await call("acme-bot", "POST", "/api/channels/acme-site/files", { name: "hero.txt", contentType: "text/plain", data: hello })).json)
    expect(file).toMatchObject({ channel: "acme-site", size: 10, messageId: null, uploadedBy: "acme-bot" })
    const root = PostMessageResult.parse((await call("simon", "POST", "/api/channels/acme-site/messages", { text: "Send the hero" })).json).message
    const reply = Reply.parse((await call("acme-bot", "POST", `/api/threads/${root.id}/replies`, { text: "Here it is", files: [file.id] })).json)
    expect(reply.files.map((f) => f.id)).toEqual([file.id])
    const content = FileContent.parse((await call("simon", "GET", `/api/files/${file.id}/content`)).json)
    expect(atob(content.data)).toBe("hello hero")
    const raw = await call("simon", "GET", `/api/files/${file.id}/raw`)
    expect(raw.type).toBe("text/plain")
    expect(new TextDecoder().decode(raw.bytes ?? new Uint8Array())).toBe("hello hero")
    const mine = FileRef.parse((await call("simon", "POST", "/api/channels/backend/files", { name: "plan.txt", data: hello })).json)
    expect((await call("acme-bot", "GET", `/api/files/${mine.id}/raw`)).status).toBe(403)
    expect((await call("acme-bot", "GET", `/api/files/${mine.id}/content`)).status).toBe(403)
  })

  test("only your own unattached file in the same channel can be attached; too big is refused", async () => {
    const { call } = await boardWithFiles()
    const mine = FileRef.parse((await call("simon", "POST", "/api/channels/backend/files", { name: "plan.txt", data: hello })).json)
    expect((await call("claude", "POST", "/api/channels/backend/messages", { text: "stolen", files: [mine.id] })).status).toBe(400)
    expect((await call("simon", "POST", "/api/channels/platform/messages", { text: "wrong channel", files: [mine.id] })).status).toBe(400)
    expect((await call("simon", "POST", "/api/channels/backend/messages", { text: "the plan", files: [mine.id] })).status).toBe(200)
    expect((await call("simon", "POST", "/api/channels/backend/messages", { text: "again", files: [mine.id] })).status).toBe(400)
    const big = btoa("x".repeat(5_000_001))
    expect((await call("simon", "POST", "/api/channels/backend/files", { name: "big.bin", data: big })).status).toBe(400)
  })
})
