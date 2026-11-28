import { describe, expect, test } from "bun:test"
import { EventPage, LiveFrame } from "@flockr/contracts"
import { createHub } from "../src/live/hub"
import { viewerOf } from "../src/board/visibility"
import { postgresListener } from "../src/platform"
import { notifyAgents } from "../src/board/agents"
import { freshBoard } from "./harness"

describe("event log", () => {
  test("sequence numbers are gapless under concurrent writes", async () => {
    const { call } = await freshBoard()
    const writes = Array.from({ length: 25 }, (_, i) => call(i % 2 ? "claude" : "codex", "POST", "/api/channels/backend/messages", { text: `note ${i}` }))
    writes.push(call("claude", "POST", "/api/tasks/claim", {}), call("codex", "POST", "/api/tasks/claim", {}))
    const results = await Promise.all(writes)
    expect(results.every((r) => r.status === 200)).toBe(true)
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
    expect(page.events.map((e) => e.seq)).toEqual(Array.from({ length: page.head }, (_, i) => i + 1))
    expect(page.events.filter((e) => e.type === "message.posted")).toHaveLength(25)
  })

  test("reading since a sequence number resumes after it", async () => {
    const { call } = await freshBoard()
    for (let i = 0; i < 5; i++) await call("simon", "POST", "/api/channels/errors/messages", { text: `ping ${i}` })
    const all = EventPage.parse((await call("simon", "GET", "/api/events?since=0")).json)
    const tail = EventPage.parse((await call("simon", "GET", "/api/events?since=3")).json)
    expect(tail.events.map((e) => e.seq)).toEqual(all.events.filter((e) => e.seq > 3).map((e) => e.seq))
  })

  test("the live hub replays from since and then streams new events", async () => {
    const { call, connection } = await freshBoard()
    for (let i = 0; i < 3; i++) await call("simon", "POST", "/api/channels/errors/messages", { text: `ping ${i}` })
    const hub = createHub(connection.db, postgresListener(connection.sql))
    await hub.ready
    const frames: LiveFrame[] = []
    const socket = { send: (text: string) => void frames.push(LiveFrame.parse(JSON.parse(text))), close: () => undefined }
    await hub.attach(socket, 2, viewerOf("simon"))
    await call("claude", "POST", "/api/tasks/claim", {})
    const deadline = Date.now() + 5000
    const seqs = () => frames.flatMap((f) => (f.kind === "event" ? [f.event.seq] : []))
    while (!frames.some((f) => f.kind === "event" && f.event.type === "task.claimed") && Date.now() < deadline) await Bun.sleep(25)
    await hub.close()
    expect(frames[0]).toEqual({ kind: "hello", head: 4 })
    expect(seqs()).toEqual([3, 4, 5])
  })

  test("a frame published inside a transaction reaches an attached socket", async () => {
    const { connection } = await freshBoard()
    const hub = createHub(connection.db, postgresListener(connection.sql))
    await hub.ready
    const frames: LiveFrame[] = []
    await hub.attach({ send: (text: string) => void frames.push(LiveFrame.parse(JSON.parse(text))), close: () => undefined }, null, viewerOf("simon"))
    await connection.db.transaction((tx) => notifyAgents(tx, ["claude"]))
    const deadline = Date.now() + 5000
    while (!frames.some((f) => f.kind === "agents") && Date.now() < deadline) await Bun.sleep(25)
    await hub.close()
    expect(frames.find((f) => f.kind === "agents")).toEqual({ kind: "agents", names: ["claude"] })
  })
})
