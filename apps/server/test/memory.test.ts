import { describe, expect, test } from "bun:test"
import { CreatedKey, ErrorBody, MemoryItem, memoryEventTypes, memoryItemCap } from "@flockr/contracts"
import { and, eq, like, sql } from "drizzle-orm"
import { z } from "zod"
import { createApp } from "../src/app"
import { createKey } from "../src/board/keys"
import { logEmail } from "../src/email/log"
import { events, memoryItems } from "../src/db/schema"
import { resetBoard, seedBoard } from "../src/seed/seed"
import { freshBoard, testConnection } from "./harness"

type Board = Awaited<ReturnType<typeof freshBoard>>

const Items = z.array(MemoryItem)
const noteAdded = (board: Board, who: string, agent: string, body: Record<string, unknown>) => board.call(who, "POST", `/api/agents/${agent}/notes`, body)
const memoryEvents = (board: Board) => board.db.select().from(events).where(like(events.type, "memory.%")).orderBy(events.seq)

describe("agent notes (10a)", () => {
  test("an agent reads and writes only its own notes; a person reads and edits any agent's", async () => {
    const board = await freshBoard()
    const added = await noteAdded(board, "claude", "claude", { text: "Simon wants short answers", kind: "preference" })
    expect(added.status).toBe(200)
    const note = MemoryItem.parse(added.json)
    expect(note).toMatchObject({ scope: "agent", owner: "claude", kind: "preference", createdBy: "claude", archivedAt: null })

    for (const [method, path, body] of [
      ["GET", "/api/agents/claude/notes", undefined],
      ["POST", "/api/agents/claude/notes", { text: "sneaky" }],
      ["PATCH", `/api/agents/claude/notes/${note.id}`, { text: "sneaky" }],
      ["POST", `/api/agents/claude/notes/${note.id}/archive`, undefined],
    ] as const) {
      const refused = await board.call("codex", method, path, body)
      expect(refused.status).toBe(403)
      expect(ErrorBody.parse(refused.json).kind).toBe("forbidden")
    }

    const edited = await board.call("tim", "PATCH", `/api/agents/claude/notes/${note.id}`, { text: "Simon wants short answers, no tables" })
    expect(MemoryItem.parse(edited.json)).toMatchObject({ text: "Simon wants short answers, no tables", createdBy: "claude", updatedBy: "tim" })
    expect(Items.parse((await board.call("tim", "GET", "/api/agents/claude/notes")).json).map((n) => n.id)).toEqual([note.id])
    expect((await board.call("simon", "GET", "/api/agents/nobody/notes")).status).toBe(404)
    expect((await board.call("simon", "GET", "/api/agents/tim/notes")).status).toBe(404)
    expect(Items.parse((await board.call("codex", "GET", "/api/agents/codex/notes")).json)).toEqual([])
  })

  test("adding with the same key twice, even at once, keeps one note and writes one event", async () => {
    const board = await freshBoard()
    const results = await Promise.all(Array.from({ length: 6 }, () => noteAdded(board, "claude", "claude", { text: "Use uuid keys", kind: "decision", key: "m12-uuid" })))
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200))
    expect(new Set(results.map((r) => MemoryItem.parse(r.json).id)).size).toBe(1)
    expect(await board.db.select().from(memoryItems)).toHaveLength(1)
    expect((await memoryEvents(board)).map((e) => e.type)).toEqual([memoryEventTypes.added])
  })

  test("every edit, archive and restore is an event; a repeat or an unchanged edit writes nothing", async () => {
    const board = await freshBoard()
    const note = MemoryItem.parse((await noteAdded(board, "claude", "claude", { text: "Staging is staging.example.com", tags: ["infra", "infra"], sourceThread: "m12" })).json)
    expect(note).toMatchObject({ kind: "fact", tags: ["infra"], sourceThread: "m12" })
    const path = `/api/agents/claude/notes/${note.id}`
    await board.call("claude", "PATCH", path, { text: "Staging is staging.example.com" })
    await board.call("claude", "PATCH", path, { kind: "decision" })
    await board.call("claude", "POST", `${path}/archive`)
    await board.call("claude", "POST", `${path}/archive`)
    const edit = await board.call("claude", "PATCH", path, { text: "late" })
    expect(edit.status).toBe(409)
    expect(Items.parse((await board.call("claude", "GET", "/api/agents/claude/notes")).json)).toEqual([])
    expect(Items.parse((await board.call("claude", "GET", "/api/agents/claude/notes?state=archived")).json).map((n) => n.id)).toEqual([note.id])
    await board.call("claude", "POST", `${path}/restore`)
    await board.call("claude", "POST", `${path}/restore`)
    expect((await memoryEvents(board)).map((e) => e.type)).toEqual(["memory.added", "memory.updated", "memory.archived", "memory.restored"])
  })

  test("the live notes of one agent stop at the cap until one is archived", async () => {
    const board = await freshBoard()
    const cap = memoryItemCap.agent
    await board.db.insert(memoryItems).values(Array.from({ length: cap }, (_, i) => ({ scope: "agent" as const, owner: "claude", kind: "fact" as const, text: `n${i}`, createdBy: "claude", updatedBy: "claude" })))
    const refused = await noteAdded(board, "claude", "claude", { text: "one too many" })
    expect(refused.status).toBe(409)
    const [first] = await board.db.select().from(memoryItems).where(and(eq(memoryItems.owner, "claude"), eq(memoryItems.text, "n0")))
    await board.call("claude", "POST", `/api/agents/claude/notes/${first?.id}/archive`)
    expect((await noteAdded(board, "claude", "claude", { text: "now there is room" })).status).toBe(200)
    expect(await board.db.select({ n: sql<number>`count(*)::int` }).from(memoryItems)).toEqual([{ n: cap + 1 }])
  })
})

describe("channel memory (10b)", () => {
  test("any member adds; a person changes any item, an agent only its own; every change is an event in the channel", async () => {
    const board = await freshBoard()
    const byAgent = MemoryItem.parse((await board.call("claude", "POST", "/api/channels/backend/memory", { text: "Primary keys are uuid", kind: "decision", sourceThread: "806" })).json)
    const byPerson = MemoryItem.parse((await board.call("simon", "POST", "/api/channels/backend/memory", { text: "Release is Friday" })).json)
    expect(byAgent).toMatchObject({ scope: "channel", owner: "backend", createdBy: "claude", sourceThread: "806" })

    expect((await board.call("claude", "PATCH", `/api/channels/backend/memory/${byAgent.id}`, { text: "Primary keys are uuid v7" })).status).toBe(200)
    const refused = await board.call("claude", "PATCH", `/api/channels/backend/memory/${byPerson.id}`, { text: "Release is Monday" })
    expect(refused.status).toBe(403)
    expect((await board.call("codex", "POST", `/api/channels/backend/memory/${byAgent.id}/archive`)).status).toBe(403)
    expect((await board.call("simon", "POST", `/api/channels/backend/memory/${byAgent.id}/archive`)).status).toBe(200)
    expect(Items.parse((await board.call("codex", "GET", "/api/channels/backend/memory")).json).map((m) => m.id)).toEqual([byPerson.id])
    expect((await board.call("simon", "PATCH", `/api/channels/platform/memory/${byPerson.id}`, { text: "x" })).status).toBe(404)
    expect((await board.call("simon", "GET", "/api/channels/nowhere/memory")).status).toBe(404)
    expect((await memoryEvents(board)).map((e) => [e.type, e.channel])).toEqual([
      ["memory.added", "backend"],
      ["memory.added", "backend"],
      ["memory.updated", "backend"],
      ["memory.archived", "backend"],
    ])
  })

  test("agent notes and channel memory never mix, even for the same name", async () => {
    const board = await freshBoard()
    await board.call("claude", "POST", "/api/channels/backend/memory", { text: "channel fact" })
    await noteAdded(board, "claude", "claude", { text: "private note" })
    expect(Items.parse((await board.call("claude", "GET", "/api/channels/backend/memory")).json).map((m) => m.text)).toEqual(["channel fact"])
    expect(Items.parse((await board.call("claude", "GET", "/api/agents/claude/notes")).json).map((m) => m.text)).toEqual(["private note"])
  })
})

describe("memory with sign-in on", () => {
  test("a key acts as its member; a key limited to channels reaches only those channels' memory and no notes", async () => {
    const connection = await testConnection()
    await resetBoard(connection.db)
    await seedBoard(connection.db)
    const origin = "http://localhost"
    const app = createApp(connection.db, { auth: { mode: "on", people: new Map(), secret: "test-secret-for-the-memory-tests-only", baseURL: origin, email: logEmail(() => undefined) } })
    const key = async (member: string, channels: string[] | null) => CreatedKey.parse(await createKey(connection.db, "simon", { member, channels })).secret
    const call = async (secret: string, method: string, path: string, body?: unknown) => {
      const response = await app.request(path, {
        method,
        headers: { origin, authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return response.status
    }
    const claude = await key("claude", null)
    const scoped = await key("claude", ["backend"])
    expect(await call(claude, "POST", "/api/agents/claude/notes", { text: "mine" })).toBe(200)
    expect(await call(claude, "GET", "/api/agents/codex/notes")).toBe(403)
    expect(await call(scoped, "GET", "/api/agents/claude/notes")).toBe(403)
    expect(await call(scoped, "POST", "/api/channels/backend/memory", { text: "in scope" })).toBe(200)
    expect(await call(scoped, "GET", "/api/channels/backend/memory")).toBe(200)
    expect(await call(scoped, "GET", "/api/channels/platform/memory")).toBe(403)
    expect(await call(scoped, "POST", "/api/channels/platform/memory", { text: "out of scope" })).toBe(403)
    expect(await call(await key("tim", null), "GET", "/api/channels/platform/memory")).toBe(200)
  })
})
