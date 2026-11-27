import { describe, expect, test } from "bun:test"
import { ErrorBody, memberHeader, SaveChunkResult, SavedSession, SessionChunk, sessionChunkKey, sessionEventTypes, Task } from "@flockr/contracts"
import { like } from "drizzle-orm"
import { createApp } from "../src/app"
import { events } from "../src/db/schema"
import { memoryStore } from "../src/storage/memory"
import { freshBoard } from "./harness"

const b64 = (text: string) => Buffer.from(text).toString("base64")
const text = (data: string) => Buffer.from(data, "base64").toString()

async function sessionBoard() {
  const board = await freshBoard()
  const store = memoryStore()
  const app = createApp(board.db, { objects: store })
  const call = async (member: string, method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { [memberHeader]: member, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: await response.json() }
  }
  const base = (session: string) => `/api/agents/claude/sessions/${session}`
  const open = async (session: string, body: Record<string, unknown> = {}) => SavedSession.parse((await call("claude", "POST", `${base(session)}/open`, body)).json)
  const save = (session: string, body: { fence: unknown; turn: number; data: string }) => call("claude", "POST", `${base(session)}/chunks`, body)
  const restore = async (session: string) => {
    const pointer = SavedSession.parse((await call("claude", "GET", base(session))).json)
    const chunks = []
    for (const chunk of pointer.chunks) chunks.push(text(SessionChunk.parse((await call("claude", "GET", `${base(session)}/chunks/${chunk.turn}`)).json).data))
    return chunks
  }
  return { ...board, store, call, open, save, restore }
}

const refusedKind = (result: { status: number; json: unknown }) => {
  expect(result.status).toBe(409)
  return ErrorBody.parse(result.json).kind
}

describe("saved sessions (PL5)", () => {
  test("a save under a stale session fence is refused once a restoring worker opens the session", async () => {
    const board = await sessionBoard()
    const first = await board.open("agent")
    expect(first.fence).toBe("session-1")
    expect((await board.save("agent", { fence: { kind: "session", epoch: 1 }, turn: 1, data: b64("one") })).status).toBe(200)

    const restored = await board.open("agent")
    expect(restored).toMatchObject({ fence: "session-2", epoch: 2, turns: 1 })
    expect(refusedKind(await board.save("agent", { fence: { kind: "session", epoch: 1 }, turn: 2, data: b64("two from the old worker") }))).toBe("stale_claim")
    expect((await board.save("agent", { fence: { kind: "session", epoch: 2 }, turn: 2, data: b64("two") })).status).toBe(200)
    expect(await board.restore("agent")).toEqual(["one", "two"])
  })

  test("a save under a claim fence is refused once the claim is gone", async () => {
    const board = await sessionBoard()
    const task = Task.parse((await board.call("claude", "POST", "/api/tasks/806/claim")).json)
    await board.open("run-806", { claim: { task: task.id, epoch: task.claimEpoch }, thread: "806" })
    const fence = { kind: "claim", task: task.id, epoch: task.claimEpoch }
    expect((await board.save("run-806", { fence, turn: 1, data: b64("one") })).status).toBe(200)
    await board.call("claude", "POST", "/api/tasks/806/release", { epoch: task.claimEpoch, keepAssignee: false })
    expect(refusedKind(await board.save("run-806", { fence, turn: 2, data: b64("two") }))).toBe("stale_claim")
  })

  test("sending the same chunk twice saves it once and writes one event", async () => {
    const board = await sessionBoard()
    await board.open("agent")
    const body = { fence: { kind: "session", epoch: 1 }, turn: 1, data: b64("one") }
    const first = SaveChunkResult.parse((await board.save("agent", body)).json)
    const again = SaveChunkResult.parse((await board.save("agent", body)).json)
    expect(first.saved).toBe(true)
    expect(again).toMatchObject({ saved: false, session: { turns: 1 } })
    expect(await board.db.select().from(events).where(like(events.type, sessionEventTypes.saved))).toHaveLength(1)
    expect(board.store.keys()).toEqual([sessionChunkKey({ agent: "claude", session: "agent", fence: "session-1", turn: 1 })])
  })

  test("different content for a used key is refused, whether the pointer has it or not", async () => {
    const board = await sessionBoard()
    await board.open("agent")
    const fence = { kind: "session", epoch: 1 }
    await board.save("agent", { fence, turn: 1, data: b64("one") })
    expect(refusedKind(await board.save("agent", { fence, turn: 1, data: b64("other") }))).toBe("already_exists")

    await board.store.create(sessionChunkKey({ agent: "claude", session: "agent", fence: "session-1", turn: 2 }), new TextEncoder().encode("left by a crash"), "application/octet-stream")
    expect(refusedKind(await board.save("agent", { fence, turn: 2, data: b64("two") }))).toBe("already_exists")
    expect(await board.restore("agent")).toEqual(["one"])
  })

  test("a restore reads the chunks in turn order across fences", async () => {
    const board = await sessionBoard()
    await board.open("agent")
    await board.save("agent", { fence: { kind: "session", epoch: 1 }, turn: 1, data: b64("one") })
    await board.save("agent", { fence: { kind: "session", epoch: 1 }, turn: 2, data: b64("two") })
    const reopened = await board.open("agent")
    expect(reopened.chunks.map((c) => [c.turn, c.fence])).toEqual([
      [1, "session-1"],
      [2, "session-1"],
    ])
    await board.save("agent", { fence: { kind: "session", epoch: 2 }, turn: 3, data: b64("three") })
    expect(refusedKind(await board.save("agent", { fence: { kind: "session", epoch: 2 }, turn: 5, data: b64("five") }))).toBe("wrong_state")
    expect(await board.restore("agent")).toEqual(["one", "two", "three"])
  })

  test("an orphan chunk, uploaded with no pointer entry, is ignored by a restore and replaced by the retry", async () => {
    const board = await sessionBoard()
    await board.open("agent")
    await board.save("agent", { fence: { kind: "session", epoch: 1 }, turn: 1, data: b64("one") })
    await board.store.create(sessionChunkKey({ agent: "claude", session: "agent", fence: "session-1", turn: 2 }), new TextEncoder().encode("two"), "application/octet-stream")
    expect(await board.restore("agent")).toEqual(["one"])

    await board.open("agent")
    await board.save("agent", { fence: { kind: "session", epoch: 2 }, turn: 2, data: b64("two again") })
    expect(await board.restore("agent")).toEqual(["one", "two again"])
  })
})
