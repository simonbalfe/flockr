import { describe, expect, test } from "bun:test"
import { ClaimResult, ErrorBody, EventPage, Inbox, Task, Thread } from "@flockr/contracts"
import { eq } from "drizzle-orm"
import { sweepExpiredClaims } from "../src/board/claims"
import { tasks } from "../src/db/schema"
import { freshBoard } from "./harness"

const task = (json: unknown) => Task.parse(json)
const claimed = (json: unknown) => ClaimResult.parse(json).task

describe("claims", () => {
  test("two parallel claims of the next ready task: exactly one wins", async () => {
    for (let round = 0; round < 5; round++) {
      const { call } = await freshBoard()
      const [a, b] = await Promise.all([
        call("claude", "POST", "/api/tasks/claim", { labels: ["schema"] }),
        call("codex", "POST", "/api/tasks/claim", { labels: ["schema"] }),
      ])
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      const winners = [claimed(a.json), claimed(b.json)].filter((t) => t !== null)
      expect(winners).toHaveLength(1)
      expect(winners[0]?.id).toBe(806)
      expect(winners[0]?.claimEpoch).toBe(1)
    }
  })

  test("two parallel claims of one task by id: one 200, one 409", async () => {
    const { call } = await freshBoard()
    const results = await Promise.all([call("claude", "POST", "/api/tasks/806/claim"), call("codex", "POST", "/api/tasks/806/claim")])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const after = await call("simon", "GET", "/api/tasks/806")
    expect(task(after.json).state).toBe("claimed")
    expect(task(after.json).claimEpoch).toBe(1)
  })

  test("a stale claim epoch is refused with 409 on complete, reply and renew", async () => {
    const { call } = await freshBoard()
    const first = claimed((await call("claude", "POST", "/api/tasks/claim", {})).json)
    expect(first?.id).toBe(806)
    expect((await call("claude", "POST", "/api/tasks/806/release", { epoch: 1 })).status).toBe(200)
    const second = claimed((await call("claude", "POST", "/api/tasks/claim", {})).json)
    expect(second?.claimEpoch).toBe(2)
    for (const [path, body] of [
      ["/api/tasks/806/complete", { epoch: 1 }],
      ["/api/tasks/806/renew", { epoch: 1 }],
      ["/api/threads/806/replies", { text: "late progress", epoch: 1 }],
    ] as const) {
      const res = await call("claude", "POST", path, body)
      expect(res.status).toBe(409)
      expect(ErrorBody.parse(res.json)).toMatchObject({ kind: "stale_claim" })
    }
    expect((await call("claude", "POST", "/api/tasks/806/complete", { epoch: 2 })).status).toBe(200)
  })

  test("an agent that does not hold the task cannot complete it", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    expect((await call("codex", "POST", "/api/tasks/806/complete", {})).status).toBe(409)
  })

  test("a task assigned to one agent is claimable only by that agent", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    await call("claude", "POST", "/api/tasks/806/complete", {})
    const res = await call("codex", "POST", "/api/tasks/808/claim")
    expect(ErrorBody.parse(res.json)).toMatchObject({ kind: "not_holder" })
    expect(claimed((await call("codex", "POST", "/api/tasks/claim", {})).json)?.id).not.toBe(808)
  })

  test("a renew after the lease ran out is refused", async () => {
    const { call, db } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    await db.update(tasks).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(tasks.id, 806))
    const res = await call("claude", "POST", "/api/tasks/806/renew", { epoch: 1 })
    expect(ErrorBody.parse(res.json)).toMatchObject({ kind: "lease_expired" })
  })

  test("an expired lease returns the task to ready and writes an event", async () => {
    const { call, db } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    await db.update(tasks).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(tasks.id, 806))
    const expired = await sweepExpiredClaims(db)
    expect(expired).toContain(806)
    const after = task((await call("simon", "GET", "/api/tasks/806")).json)
    expect(after.state).toBe("ready")
    expect(after.holder).toBeNull()
    const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0")).json)
    expect(page.events.some((e) => e.type === "task.expired" && e.taskId === 806)).toBe(true)
  })

  test("a claim with an open question does not expire, and a second sweep changes nothing", async () => {
    const { db } = await freshBoard()
    const later = new Date(Date.now() + 60 * 60_000)
    expect(await sweepExpiredClaims(db, later)).toEqual([803, 820])
    expect(await sweepExpiredClaims(db, later)).toEqual([])
  })

  test("completing #806 turns #808 ready, and #812 stays waiting", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    await call("claude", "POST", "/api/tasks/806/complete", { epoch: 1, note: "Table designed in SPEC_USERS.md" })
    expect(task((await call("simon", "GET", "/api/tasks/808")).json).state).toBe("ready")
    expect(task((await call("simon", "GET", "/api/tasks/812")).json).state).toBe("waiting")
    const mine = claimed((await call("claude", "POST", "/api/tasks/claim", { mine: true })).json)
    expect(mine?.id).toBe(808)
  })

  test("a question is asked, shows in the inbox and is answered", async () => {
    const { call } = await freshBoard()
    await call("claude", "POST", "/api/tasks/806/claim")
    const asked = await call("claude", "POST", "/api/tasks/806/ask", { text: "Use uuid keys?", options: ["Yes", "No"], epoch: 1 })
    expect(asked.status).toBe(200)
    const inbox = Inbox.parse((await call("simon", "GET", "/api/inbox")).json)
    expect(inbox.questions.map((t) => t.id)).toContain(806)
    expect((await call("simon", "POST", "/api/tasks/806/answer", { option: "Maybe" })).status).toBe(400)
    expect((await call("simon", "POST", "/api/tasks/806/answer", { option: "Yes" })).status).toBe(200)
    const thread = Thread.parse((await call("claude", "GET", "/api/threads/806")).json)
    expect(thread.entries.at(-1)).toMatchObject({ text: "Yes." })
  })
})
