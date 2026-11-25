import { describe, expect, test } from "bun:test"
import { Channel, CreatedKey, ErrorBody, Focus, Plan, PlanDetail, Task } from "@flockr/contracts"
import { asc, eq, like, or, sql } from "drizzle-orm"
import { z } from "zod"
import { createApp } from "../src/app"
import { createKey } from "../src/board/keys"
import { events, plans, tasks } from "../src/db/schema"
import { logEmail } from "../src/email/log"
import { resetBoard, seedBoard } from "../src/seed/seed"
import { freshBoard, testConnection } from "./harness"

type Board = Awaited<ReturnType<typeof freshBoard>>

const Plans = z.array(Plan)
const PlanData = z.object({ plan: z.number().nullable() })
const PlannedData = z.object({ task: z.number(), plan: z.number().nullable(), from: z.number().nullable() })

const makePlan = async (board: Board, body: Record<string, unknown>, who = "simon") => Plan.parse((await board.call(who, "POST", "/api/plans", body)).json)
const makeTask = async (board: Board, body: Record<string, unknown>, who = "simon") => Task.parse((await board.call(who, "POST", "/api/tasks", body)).json)

async function planEvents(board: Board, plan: number) {
  const rows = await board.db
    .select()
    .from(events)
    .where(or(like(events.type, "plan.%"), eq(events.type, "task.planned"), eq(events.type, "task.created")))
    .orderBy(asc(events.seq))
  return rows.filter((row) => {
    if (row.type === "task.planned") {
      const data = PlannedData.parse(row.data)
      return data.plan === plan || data.from === plan
    }
    return PlanData.safeParse(row.data).data?.plan === plan
  })
}

const kind = (response: { json: unknown }) => ErrorBody.parse(response.json).kind

describe("plans (12a)", () => {
  test("creating with the same key twice, even at once, gives one plan and one event", async () => {
    const board = await freshBoard()
    const results = await Promise.all(Array.from({ length: 6 }, () => board.call("claude", "POST", "/api/plans", { channel: "backend", title: "Users API", key: "users-api-week" })))
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200))
    const ids = new Set(results.map((r) => Plan.parse(r.json).id))
    expect(ids.size).toBe(1)
    const [id] = [...ids]
    if (id === undefined) throw new Error("no plan")
    expect(await board.db.select().from(plans).where(eq(plans.key, "users-api-week"))).toHaveLength(1)
    expect((await planEvents(board, id)).map((e) => e.type)).toEqual(["plan.created"])
    const elsewhere = await makePlan(board, { channel: "platform", title: "Users API", key: "users-api-week" })
    expect(elsewhere.id).not.toBe(id)
  })

  test("a task joins only an open plan in its own channel; a refused join changes nothing and writes no event", async () => {
    const board = await freshBoard()
    const backend = await makePlan(board, { channel: "backend", title: "Users API" })
    const platform = await makePlan(board, { channel: "platform", title: "Cold starts" })
    const task = await makeTask(board, { channel: "backend", title: "Build the /users API" })
    const before = await planEvents(board, platform.id)

    const crossJoin = await board.call("simon", "PUT", `/api/tasks/${task.id}/plan`, { plan: platform.id })
    expect(crossJoin.status).toBe(409)
    expect(kind(crossJoin)).toBe("wrong_state")
    const crossCreate = await board.call("simon", "POST", "/api/tasks", { channel: "backend", title: "Sign-up form", plan: platform.id })
    expect(crossCreate.status).toBe(409)

    await board.call("simon", "POST", `/api/plans/${backend.id}/close`)
    expect((await board.call("simon", "PUT", `/api/tasks/${task.id}/plan`, { plan: backend.id })).status).toBe(409)
    expect((await board.call("simon", "POST", "/api/tasks", { channel: "backend", title: "Sign-up form", plan: backend.id })).status).toBe(409)
    expect((await board.call("simon", "PUT", `/api/tasks/${task.id}/plan`, { plan: 999999 })).status).toBe(404)

    expect(Task.parse((await board.call("simon", "GET", `/api/tasks/${task.id}`)).json).planId).toBeNull()
    expect(await board.db.select().from(tasks).where(eq(tasks.title, "Sign-up form"))).toHaveLength(0)
    expect(await planEvents(board, platform.id)).toEqual(before)
    expect((await planEvents(board, backend.id)).map((e) => e.type)).toEqual(["plan.created", "plan.closed"])
  })

  test("create with a plan writes task.created carrying the plan; moving and removing write task.planned; the same plan again writes nothing", async () => {
    const board = await freshBoard()
    const plan = await makePlan(board, { channel: "backend", title: "Users API" })
    const other = await makePlan(board, { channel: "backend", title: "Docs" })
    const created = await makeTask(board, { channel: "backend", title: "Design the users table", plan: plan.id })
    expect(created.planId).toBe(plan.id)
    const createdEvents = await planEvents(board, plan.id)
    expect(createdEvents.map((e) => e.type)).toEqual(["plan.created", "task.created"])

    await board.call("simon", "PUT", `/api/tasks/${created.id}/plan`, { plan: plan.id })
    expect(await planEvents(board, plan.id)).toEqual(createdEvents)

    const moved = Task.parse((await board.call("simon", "PUT", `/api/tasks/${created.id}/plan`, { plan: other.id })).json)
    expect(moved.planId).toBe(other.id)
    const removed = Task.parse((await board.call("simon", "PUT", `/api/tasks/${created.id}/plan`, { plan: null })).json)
    expect(removed.planId).toBeNull()
    const planned = (await planEvents(board, other.id)).filter((e) => e.type === "task.planned").map((e) => PlannedData.parse(e.data))
    expect(planned).toEqual([
      { task: created.id, plan: other.id, from: plan.id },
      { task: created.id, plan: null, from: other.id },
    ])
  })

  test("close and reopen repeats write no event, and an update that changes nothing writes nothing", async () => {
    const board = await freshBoard()
    const plan = await makePlan(board, { channel: "backend", title: "Users API", goal: "Sign-up this week" })
    for (let i = 0; i < 2; i++) expect(Plan.parse((await board.call("simon", "POST", `/api/plans/${plan.id}/close`)).json).state).toBe("closed")
    for (let i = 0; i < 2; i++) expect(Plan.parse((await board.call("claude", "POST", `/api/plans/${plan.id}/reopen`)).json).state).toBe("open")
    await board.call("simon", "PATCH", `/api/plans/${plan.id}`, { title: "Users API", goal: "Sign-up this week" })
    await board.call("simon", "PATCH", `/api/plans/${plan.id}`, {})
    const edited = Plan.parse((await board.call("simon", "PATCH", `/api/plans/${plan.id}`, { title: "Users API v1" })).json)
    expect(edited).toMatchObject({ title: "Users API v1", goal: "Sign-up this week" })
    const written = await planEvents(board, plan.id)
    expect(written.map((e) => e.type)).toEqual(["plan.created", "plan.closed", "plan.reopened", "plan.updated"])
    expect(written.at(-1)?.data).toMatchObject({ changed: ["title"] })
    expect(written.map((e) => e.actor)).toEqual(["simon", "simon", "claude", "simon"])
  })

  test("progress follows task state changes and closed plans leave the open list", async () => {
    const board = await freshBoard()
    const plan = await makePlan(board, { channel: "backend", title: "Users API" })
    const first = await makeTask(board, { channel: "backend", title: "Design the users table", plan: plan.id })
    const second = await makeTask(board, { channel: "backend", title: "Build the /users API", plan: plan.id, needs: [first.id] })
    const progress = async () => PlanDetail.parse((await board.call("simon", "GET", `/api/plans/${plan.id}`)).json).progress
    expect(await progress()).toMatchObject({ total: 2, ready: 1, waiting: 1, done: 0 })

    const claimed = Task.parse((await board.call("claude", "POST", `/api/tasks/${first.id}/claim`)).json)
    expect(await progress()).toMatchObject({ total: 2, claimed: 1, waiting: 1 })
    await board.call("claude", "POST", `/api/tasks/${first.id}/complete`, { epoch: claimed.claimEpoch })
    expect(await progress()).toMatchObject({ total: 2, done: 1, ready: 1, waiting: 0 })

    const detail = PlanDetail.parse((await board.call("simon", "GET", `/api/plans/${plan.id}`)).json)
    expect(detail.tasks.map((t) => t.id)).toEqual([first.id, second.id])
    expect(Plans.parse((await board.call("simon", "GET", "/api/plans?channel=backend")).json).map((p) => p.id)).toContain(plan.id)
    await board.call("simon", "POST", `/api/plans/${plan.id}/close`)
    expect(Plans.parse((await board.call("simon", "GET", "/api/plans?channel=backend")).json).map((p) => p.id)).not.toContain(plan.id)
    expect(Plans.parse((await board.call("simon", "GET", "/api/plans?state=closed")).json).map((p) => p.id)).toContain(plan.id)
  })

  test("a channel keeps at most the open plan limit, counted under concurrent creates", async () => {
    const board = await freshBoard()
    const [open] = await board.db
      .select({ count: sql<number>`count(*)::int` })
      .from(plans)
      .where(sql`${plans.channel} = 'reviews' and ${plans.closedAt} is null`)
    const room = 50 - (open?.count ?? 0)
    const results = await Promise.all(Array.from({ length: room + 3 }, (_, i) => board.call("simon", "POST", "/api/plans", { channel: "reviews", title: `Plan ${i}` })))
    expect(results.filter((r) => r.status === 200)).toHaveLength(room)
    expect(results.filter((r) => r.status === 409)).toHaveLength(3)
  })

  test("a key limited to channels sees and changes only its channels' plans", async () => {
    const connection = await testConnection()
    await resetBoard(connection.db)
    await seedBoard(connection.db)
    const origin = "http://localhost"
    const app = createApp(connection.db, { auth: { mode: "on", people: new Map(), secret: "test-secret-for-the-plans-tests-only", baseURL: origin, email: logEmail(() => undefined) } })
    const key = async (channels: string[] | null) => CreatedKey.parse(await createKey(connection.db, "simon", { member: "claude", channels })).secret
    const call = async (secret: string, method: string, path: string, body?: unknown) => {
      const response = await app.request(path, {
        method,
        headers: { origin, authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: response.status, json: await response.json() }
    }
    const full = await key(null)
    const scoped = await key(["backend"])
    const backend = Plan.parse((await call(full, "POST", "/api/plans", { channel: "backend", title: "Users API" })).json)
    const platform = Plan.parse((await call(full, "POST", "/api/plans", { channel: "platform", title: "Cold starts" })).json)

    const seen = Plans.parse((await call(scoped, "GET", "/api/plans")).json)
    expect(seen.map((p) => p.id)).toContain(backend.id)
    expect(seen.every((p) => p.channel === "backend")).toBe(true)
    expect(Plans.parse((await call(scoped, "GET", "/api/plans?channel=platform")).json)).toEqual([])
    expect((await call(scoped, "GET", `/api/plans/${platform.id}`)).status).toBe(403)
    expect((await call(scoped, "POST", `/api/plans/${platform.id}/close`)).status).toBe(403)
    expect((await call(scoped, "POST", "/api/plans", { channel: "platform", title: "Sneaky" })).status).toBe(403)
    expect((await call(scoped, "GET", `/api/plans/${backend.id}`)).status).toBe(200)
    expect(Plans.parse((await call(full, "GET", "/api/plans")).json).map((p) => p.id)).toContain(platform.id)
  })

  test("a plan in a direct message is hidden from everyone outside it", async () => {
    const board = await freshBoard()
    const dm = Channel.parse((await board.call("simon", "POST", "/api/dms", { with: "claude" })).json)
    const plan = await makePlan(board, { channel: dm.id, title: "Private plan" })
    expect(Plans.parse((await board.call("claude", "GET", "/api/plans")).json).map((p) => p.id)).toContain(plan.id)
    expect(Plans.parse((await board.call("codex", "GET", "/api/plans")).json).map((p) => p.id)).not.toContain(plan.id)
    expect(Plans.parse((await board.call("tim", "GET", `/api/plans?channel=${dm.id}`)).json)).toEqual([])
    expect((await board.call("tim", "GET", `/api/plans/${plan.id}`)).status).toBe(403)
    expect((await board.call("tim", "PATCH", `/api/plans/${plan.id}`, { title: "Mine now" })).status).toBe(403)
    expect((await board.call("tim", "POST", "/api/plans", { channel: dm.id, title: "Mine" })).status).toBe(403)
    expect(Focus.parse((await board.call("tim", "GET", "/api/focus")).json).plans.map((p) => p.id)).not.toContain(plan.id)
    expect(Focus.parse((await board.call("simon", "GET", "/api/focus")).json).plans.map((p) => p.id)).toContain(plan.id)
  })
})
