import { describe, expect, test } from "bun:test"
import { ClaimResult, Plan, PlanWait, Task } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

type Call = Awaited<ReturnType<typeof freshBoard>>["call"]

const later = (ms: number, run: () => Promise<unknown>) => new Promise((resolve) => setTimeout(() => resolve(run()), ms))
const make = async (call: Call, title: string, extra: Record<string, unknown> = {}) => Task.parse((await call("simon", "POST", "/api/tasks", { channel: "frontend", title, ...extra })).json)

describe("task queue gaps (13f)", () => {
  test("a claim with a wait returns the matching task made while it waits, and times out with null", async () => {
    const { call } = await freshBoard()
    await call("simon", "POST", "/api/channels", { id: "frontend" })
    const waiting = call("claude", "POST", "/api/tasks/claim", { labels: ["css"], wait: 3 })
    await later(300, () => make(call, "Unlabelled"))
    const made = (await later(500, () => make(call, "Fix the header", { labels: ["css"] }))) as Task
    const got = ClaimResult.parse((await waiting).json)
    expect(got.task).toMatchObject({ id: made.id, holder: "claude" })
    const empty = ClaimResult.parse((await call("claude", "POST", "/api/tasks/claim", { labels: ["nothing"], wait: 1 })).json)
    expect(empty.task).toBeNull()
  })

  test("two agents waiting on one new task: exactly one gets it", async () => {
    const { call } = await freshBoard()
    await call("simon", "POST", "/api/channels", { id: "frontend" })
    const both = [call("claude", "POST", "/api/tasks/claim", { labels: ["race"], wait: 3 }), call("codex", "POST", "/api/tasks/claim", { labels: ["race"], wait: 3 })]
    await later(300, () => make(call, "Only one", { labels: ["race"] }))
    const results = (await Promise.all(both)).map((r) => ClaimResult.parse(r.json).task)
    expect(results.filter((t) => t !== null)).toHaveLength(1)
  })

  test("fail is its own state; a person reopens it, an agent cannot", async () => {
    const { call } = await freshBoard()
    const claimed = Task.parse((await call("codex", "POST", "/api/tasks/806/claim")).json)
    const failed = Task.parse((await call("codex", "POST", "/api/tasks/806/fail", { reason: "No schema access", epoch: claimed.claimEpoch })).json)
    expect(failed).toMatchObject({ state: "failed", holder: null, reason: "No schema access" })
    const blocked = z.array(Task).parse((await call("simon", "GET", "/api/tasks?state=blocked")).json)
    expect(blocked.map((t) => t.id)).not.toContain(806)
    expect((await call("codex", "POST", "/api/tasks/806/reopen")).status).toBe(403)
    expect(Task.parse((await call("simon", "POST", "/api/tasks/806/reopen")).json).state).toBe("ready")
  })

  test("cancel ends a claim; only a person or the one involved cancels; a canceled task cannot be claimed", async () => {
    const { call } = await freshBoard()
    const claimed = Task.parse((await call("claude", "POST", "/api/tasks/806/claim")).json)
    expect((await call("gemini", "POST", "/api/tasks/806/cancel", { reason: "Not needed" })).status).toBe(403)
    const canceled = Task.parse((await call("claude", "POST", "/api/tasks/806/cancel", { reason: "Replaced by #830" })).json)
    expect(canceled).toMatchObject({ state: "canceled", holder: null })
    expect((await call("claude", "POST", "/api/tasks/806/complete", { epoch: claimed.claimEpoch })).status).toBe(409)
    expect((await call("codex", "POST", "/api/tasks/806/claim")).status).toBe(409)
    expect(Task.parse((await call("tim", "POST", "/api/tasks/806/reopen")).json).state).toBe("ready")
  })

  test("waiting on a plan: open tasks keep it waiting, done and canceled finish it, failed does not", async () => {
    const { call } = await freshBoard()
    await call("simon", "POST", "/api/channels", { id: "frontend" })
    const plan = Plan.parse((await call("simon", "POST", "/api/plans", { channel: "frontend", title: "Header" })).json)
    const a = await make(call, "Logo", { plan: plan.id })
    const b = await make(call, "Menu", { plan: plan.id })
    const first = PlanWait.parse((await call("simon", "GET", `/api/plans/${plan.id}/wait?timeout=1`)).json)
    expect(first).toMatchObject({ finished: false, timedOut: true, open: [a.id, b.id] })
    const held = Task.parse((await call("claude", "POST", `/api/tasks/${a.id}/claim`)).json)
    await call("claude", "POST", `/api/tasks/${a.id}/complete`, { epoch: held.claimEpoch })
    const heldB = Task.parse((await call("claude", "POST", `/api/tasks/${b.id}/claim`)).json)
    await call("claude", "POST", `/api/tasks/${b.id}/fail`, { reason: "Design missing", epoch: heldB.claimEpoch })
    expect(PlanWait.parse((await call("simon", "GET", `/api/plans/${plan.id}/wait?timeout=0`)).json)).toMatchObject({ finished: false, open: [b.id] })
    const waiting = call("simon", "GET", `/api/plans/${plan.id}/wait?timeout=3`)
    await later(300, () => call("simon", "POST", `/api/tasks/${b.id}/cancel`, { reason: "Dropped from the header" }))
    expect(PlanWait.parse((await waiting).json)).toMatchObject({ finished: true, timedOut: false, open: [] })
  })
})
