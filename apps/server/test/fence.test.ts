import { describe, expect, test } from "bun:test"
import { ClaimResult, CreatedKey, MemoryItem, SearchResult, Task, channelsHeader, memberHeader } from "@flockr/contracts"
import { z } from "zod"
import { createKey } from "../src/board/keys"
import { freshBoard } from "./harness"

async function fencedBoard() {
  const board = await freshBoard()
  const fenced = async (member: string, channels: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const response = await board.app.request(path, {
      method,
      headers: { [memberHeader]: member, [channelsHeader]: channels, ...extra, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: (await response.json()) as unknown }
  }
  return { ...board, fenced }
}

describe("channel-fenced agent runs (11d)", () => {
  test("a run fenced to #backend reads and claims only #backend", async () => {
    const { fenced } = await fencedBoard()
    expect((await fenced("claude", "backend", "GET", "/api/channels/platform/messages")).status).toBe(403)
    expect((await fenced("claude", "backend", "GET", "/api/channels/backend/messages")).status).toBe(200)
    const tasks = z.array(Task).parse((await fenced("claude", "backend", "GET", "/api/tasks")).json)
    expect(new Set(tasks.map((t) => t.channel))).toEqual(new Set(["backend"]))
    const hits = SearchResult.parse((await fenced("claude", "backend", "GET", "/api/search?q=staging")).json)
    expect(hits.hits.every((h) => h.channel === "backend")).toBe(true)
    const claimed = ClaimResult.parse((await fenced("codex", "platform", "POST", "/api/tasks/claim", {})).json)
    expect(claimed.task?.channel ?? "platform").toBe("platform")
    expect((await fenced("claude", "backend", "GET", "/api/inbox")).status).toBe(200)
  })

  test("the fence only narrows: a key limited to #acme-site stays there whatever the header asks", async () => {
    const { call, db, fenced } = await fencedBoard()
    await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
    await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
    await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
    await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
    await call("simon", "PUT", "/api/channels/acme-site/members/acme-bot")
    const key = CreatedKey.parse(await createKey(db, "simon", { member: "acme-bot", channels: ["acme-site"] })).secret
    const widened = await fenced("acme-bot", "backend,acme-site", "GET", "/api/channels/backend/messages", undefined, { authorization: `Bearer ${key}` })
    expect(widened.status).toBe(403)
  })

  test("a fenced run sees only its channel's notes and unthreaded ones, and cannot file a note elsewhere", async () => {
    const { call, fenced } = await fencedBoard()
    const add = async (text: string, sourceThread?: string) => MemoryItem.parse((await call("claude", "POST", "/api/agents/claude/notes", { text, kind: "fact", ...(sourceThread ? { sourceThread } : {}) })).json)
    await add("Users table uses uuid keys", "806")
    const elsewhere = await add("The registry import is slow", "803")
    await add("Simon prefers short replies")
    const seen = z.array(MemoryItem).parse((await fenced("claude", "backend", "GET", "/api/agents/claude/notes")).json)
    expect(seen.map((n) => n.text).sort()).toEqual(["Simon prefers short replies", "Users table uses uuid keys"])
    expect((await fenced("claude", "backend", "POST", "/api/agents/claude/notes", { text: "leak", kind: "fact", sourceThread: "803" })).status).toBe(403)
    expect((await fenced("claude", "backend", "POST", `/api/agents/claude/notes/${elsewhere.id}/archive`)).status).toBe(404)
    expect((await fenced("claude", "backend", "POST", "/api/agents/claude/notes", { text: "From the backend thread", kind: "fact", sourceThread: "806" })).status).toBe(200)
  })

  test("another org's person cannot read our agent's notes", async () => {
    const { call } = await fencedBoard()
    await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
    await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
    await call("claude", "POST", "/api/agents/claude/notes", { text: "Deploy key lives in the vault", kind: "fact" })
    expect((await call("ana", "GET", "/api/agents/claude/notes")).status).toBe(403)
  })
})
