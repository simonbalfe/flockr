import {
  planLimits,
  type CreatePlanBody,
  ListPlansQuery,
  type Plan,
  type PlanDetail,
  type PlanProgress,
  type PlanState,
  type Task,
  type UpdatePlanBody,
  type WatchableEventType,
} from "@flockr/contracts"
import type { z } from "@hono/zod-openapi"
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { plans, tasks, type PlanRow, type TaskRow } from "../db/schema"
import { requireChannelAccess } from "./direct"
import { notFound, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { getTask, presentTasks, requireChannel } from "./read"
import { emitTask, lockTask, updateTask } from "./write"
import { visibleTo } from "./visibility"

type PlanListQuery = z.infer<typeof ListPlansQuery>

export interface PlanViewer {
  member: string
  channels: string[] | null
}

const stateOf = (row: PlanRow): PlanState => (row.closedAt === null ? "open" : "closed")

const emptyProgress = (): PlanProgress => ({ total: 0, waiting: 0, ready: 0, claimed: 0, blocked: 0, review: 0, done: 0 })

async function progressOf(db: Executor, ids: number[]): Promise<Map<number, PlanProgress>> {
  const grouped = new Map<number, PlanProgress>()
  if (!ids.length) return grouped
  const rows = await db
    .select({ plan: tasks.planId, state: tasks.state, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(inArray(tasks.planId, ids))
    .groupBy(tasks.planId, tasks.state)
  for (const row of rows) {
    if (row.plan === null) continue
    const progress = grouped.get(row.plan) ?? emptyProgress()
    progress[row.state] += row.count
    progress.total += row.count
    grouped.set(row.plan, progress)
  }
  return grouped
}

function presentPlan(row: PlanRow, progress: PlanProgress): Plan {
  return {
    id: row.id,
    channel: row.channel,
    title: row.title,
    goal: row.goal,
    state: stateOf(row),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    progress,
  }
}

export async function presentPlans(db: Executor, rows: PlanRow[]): Promise<Plan[]> {
  const progress = await progressOf(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((row) => presentPlan(row, progress.get(row.id) ?? emptyProgress()))
}

const planEvent = (emit: Emit, type: WatchableEventType, actor: string, row: PlanRow, data: Record<string, unknown> = {}) =>
  emit({ type, actor, channel: row.channel, data: { plan: row.id, title: row.title, goal: row.goal, state: stateOf(row), ...data } })

const missing = (id: number) => notFound(`Plan ${id} does not exist; flockr plans lists them`)

async function lockPlan(tx: Tx, id: number, actor: string, mode: "update" | "share"): Promise<PlanRow> {
  const [row] = await tx
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), visibleTo(plans.channel, actor)))
    .for(mode)
  if (!row) throw missing(id)
  return row
}

async function openCount(tx: Tx, channel: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(plans)
    .where(and(eq(plans.channel, channel), isNull(plans.closedAt)))
  return row?.count ?? 0
}

async function requireRoomFor(tx: Tx, channel: string): Promise<void> {
  if ((await openCount(tx, channel)) >= planLimits.openPerChannel) {
    throw wrongState(`#${channel} already has ${planLimits.openPerChannel} open plans; close one first (flockr plans close <id>)`)
  }
}

const channelLock = (tx: Tx, channel: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`plans:${channel}`}))`)

export async function listPlans(db: Executor, viewer: PlanViewer, query: PlanListQuery): Promise<Plan[]> {
  const filters: SQL[] = [visibleTo(plans.channel, viewer.member)]
  if (query.channel) filters.push(eq(plans.channel, query.channel))
  if (viewer.channels !== null) filters.push(inArray(plans.channel, viewer.channels.length ? viewer.channels : [""]))
  filters.push((query.state ?? "open") === "open" ? isNull(plans.closedAt) : isNotNull(plans.closedAt))
  const rows = await db
    .select()
    .from(plans)
    .where(and(...filters))
    .orderBy(desc(plans.id))
  return presentPlans(db, rows)
}

export async function getPlan(db: Executor, viewer: PlanViewer, id: number): Promise<PlanDetail> {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), visibleTo(plans.channel, viewer.member)))
  if (!row) throw missing(id)
  const taskRows = await db.select().from(tasks).where(eq(tasks.planId, id)).orderBy(asc(tasks.createdAt), asc(tasks.id))
  const [plan] = await presentPlans(db, [row])
  if (!plan) throw missing(id)
  return { ...plan, tasks: await presentTasks(db, taskRows) }
}

export async function createPlan(db: Database, actor: string, body: CreatePlanBody): Promise<Plan> {
  const row = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, body.channel)
    await requireChannelAccess(tx, actor, body.channel)
    await channelLock(tx, body.channel)
    if (body.key !== undefined) {
      const [same] = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.channel, body.channel), eq(plans.key, body.key)))
      if (same) return same
    }
    await requireRoomFor(tx, body.channel)
    const [created] = await tx
      .insert(plans)
      .values({ channel: body.channel, title: body.title, goal: body.goal || null, key: body.key ?? null, createdBy: actor })
      .returning()
    if (!created) throw new Error("Plan insert returned nothing")
    planEvent(emit, "plan.created", actor, created, { createdBy: actor })
    return created
  })
  const [plan] = await presentPlans(db, [row])
  if (!plan) throw missing(row.id)
  return plan
}

export async function updatePlan(db: Database, actor: string, id: number, body: UpdatePlanBody): Promise<Plan> {
  const row = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const current = await lockPlan(tx, id, actor, "update")
    const next = { title: body.title ?? current.title, goal: body.goal === undefined ? current.goal : body.goal || null }
    const changed = [...(next.title !== current.title ? ["title"] : []), ...(next.goal !== current.goal ? ["goal"] : [])]
    if (!changed.length) return current
    const [updated] = await tx
      .update(plans)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning()
    if (!updated) throw missing(id)
    planEvent(emit, "plan.updated", actor, updated, { changed, was: { title: current.title, goal: current.goal } })
    return updated
  })
  const [plan] = await presentPlans(db, [row])
  if (!plan) throw missing(id)
  return plan
}

export async function setPlanClosed(db: Database, actor: string, id: number, closed: boolean): Promise<Plan> {
  const row = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const [peek] = await tx
      .select({ channel: plans.channel })
      .from(plans)
      .where(and(eq(plans.id, id), visibleTo(plans.channel, actor)))
    if (!peek) throw missing(id)
    if (!closed) await channelLock(tx, peek.channel)
    const current = await lockPlan(tx, id, actor, "update")
    if ((current.closedAt !== null) === closed) return current
    if (!closed) await requireRoomFor(tx, current.channel)
    const now = new Date()
    const [updated] = await tx
      .update(plans)
      .set({ closedAt: closed ? now : null, updatedAt: now })
      .where(eq(plans.id, id))
      .returning()
    if (!updated) throw missing(id)
    planEvent(emit, closed ? "plan.closed" : "plan.reopened", actor, updated)
    return updated
  })
  const [plan] = await presentPlans(db, [row])
  if (!plan) throw missing(id)
  return plan
}

export async function requireJoinablePlan(tx: Tx, actor: string, id: number, channel: string): Promise<PlanRow> {
  const plan = await lockPlan(tx, id, actor, "share")
  if (plan.channel !== channel) throw wrongState(`Plan ${id} is in #${plan.channel}; a task in #${channel} can join only a plan in its own channel`)
  if (plan.closedAt !== null) throw wrongState(`Plan ${id} is closed; reopen it first (flockr plans reopen ${id})`)
  return plan
}

export async function setTaskPlan(db: Database, actor: string, taskId: number, planId: number | null): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const task: TaskRow = await lockTask(tx, taskId)
    if (task.planId === planId) return
    if (planId !== null) await requireJoinablePlan(tx, actor, planId, task.channel)
    const row = await updateTask(tx, taskId, { planId })
    emitTask(emit, "task.planned", row, actor, { task: row.id, plan: planId, from: task.planId })
  })
  return getTask(db, taskId)
}
