import {
  actionKindRules,
  JobCause,
  mayManageRoutine,
  nextRunOf,
  RoutineAction,
  routineActionKind,
  routineActor,
  routineEventTypes,
  routineLimits,
  type CreateRoutineBody,
  type DeletedRoutine,
  type Job,
  type Routine,
  type RoutineTrigger,
  type UpdateRoutineBody,
  WatchableEventType,
} from "@flockr/contracts"
import { and, asc, count, desc, eq, gt, isNull, lte, sql } from "drizzle-orm"
import { z } from "zod"
import type { Database, Executor, Tx } from "../db/client"
import { jobs, members, routines, type JobRow, type MemberRow, type RoutineRow } from "../db/schema"
import { allowedOnce, askApproval, verdictFor } from "./approvals"
import { buildBrief } from "./brief"
import { forbidden, invalid, notFound } from "./errors"
import { mutate, type Emit } from "./events"
import { enqueueJob, finishJob, lockClaimedJob, type JobOutcome } from "./jobs"
import { requireActor } from "./members"
import { mentionsOf } from "./messages"
import { findMember, messageKey, requireChannel } from "./read"
import { insertTask } from "./tasks"
import { emitMessage, insertMessage } from "./write"

const JobPayload = z.object({ cause: JobCause })

export function triggerOf(row: RoutineRow): RoutineTrigger {
  if (row.triggerKind === "cron") return { kind: "cron", schedule: row.schedule ?? "" }
  return { kind: "event", eventType: WatchableEventType.parse(row.eventType) }
}

export function presentJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    routineId: row.routineId,
    state: row.state,
    cause: JobPayload.parse(row.payload).cause,
    runAt: row.runAt.toISOString(),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    result: row.result,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

function presentRoutine(row: RoutineRow, recent: JobRow[]): Routine {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    trigger: triggerOf(row),
    action: RoutineAction.parse(row.action),
    enabled: row.enabled,
    perHour: row.perHour,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    recentJobs: recent.map(presentJob),
  }
}

const recentJobsOf = (db: Executor, id: number, limit: number) =>
  db.select().from(jobs).where(eq(jobs.routineId, id)).orderBy(desc(jobs.id)).limit(limit)

export async function listRoutines(db: Executor): Promise<Routine[]> {
  const rows = await db.select().from(routines).where(isNull(routines.deletedAt)).orderBy(asc(routines.id))
  const recent = await Promise.all(rows.map((row) => recentJobsOf(db, row.id, routineLimits.recentJobs)))
  return rows.map((row, i) => presentRoutine(row, recent[i] ?? []))
}

async function findRoutine(db: Executor, id: number): Promise<RoutineRow> {
  const [row] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, id), isNull(routines.deletedAt)))
  if (!row) throw notFound(`Routine ${id} does not exist; fc routines lists them`)
  return row
}

export async function getRoutine(db: Executor, id: number): Promise<Routine> {
  const row = await findRoutine(db, id)
  return presentRoutine(row, await recentJobsOf(db, id, routineLimits.recentJobs))
}

export async function listRoutineJobs(db: Executor, id: number, limit: number): Promise<Job[]> {
  await findRoutine(db, id)
  return (await recentJobsOf(db, id, limit)).map(presentJob)
}

async function requireManager(tx: Tx, actor: string): Promise<MemberRow> {
  const row = await requireActor(tx, actor)
  if (!mayManageRoutine(row)) throw forbidden(`${actor} is an ${row.kind}; only a person can create, change, turn on or off, or delete a routine`)
  return row
}

async function lockRoutine(tx: Tx, id: number): Promise<RoutineRow> {
  const [row] = await tx.select().from(routines).where(eq(routines.id, id)).for("update")
  if (!row || row.deletedAt) throw notFound(`Routine ${id} does not exist; fc routines lists them`)
  return row
}

async function checkAction(tx: Tx, action: RoutineAction): Promise<void> {
  switch (action.kind) {
    case "post":
    case "brief":
      return
    case "task":
      if (action.assignee !== null && !(await findMember(tx, action.assignee))) throw invalid(`Member ${action.assignee} does not exist`)
      return
    case "mention": {
      const agent = await findMember(tx, action.agent)
      if (!agent || agent.kind !== "agent") throw invalid(`${action.agent} is not an agent on this board; fc agents lists them`)
      return
    }
    default: {
      const never: never = action
      throw invalid(`Unknown action ${JSON.stringify(never)}`)
    }
  }
}

const triggerColumns = (trigger: RoutineTrigger) =>
  trigger.kind === "cron" ? { triggerKind: trigger.kind, schedule: trigger.schedule, eventType: null } : { triggerKind: trigger.kind, schedule: null, eventType: trigger.eventType }

const nextRunFor = (trigger: RoutineTrigger, enabled: boolean, now: Date) => (enabled && trigger.kind === "cron" ? nextRunOf(trigger.schedule, now) : null)

const emitRoutine = (emit: Emit, type: string, actor: string, row: RoutineRow, data: Record<string, unknown> = {}) =>
  emit({ type, actor, channel: row.channel, data: { id: row.id, name: row.name, ...data } })

export async function createRoutine(db: Database, actor: string, body: CreateRoutineBody): Promise<Routine> {
  const id = await mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    await requireChannel(tx, body.channel)
    await checkAction(tx, body.action)
    const [row] = await tx
      .insert(routines)
      .values({ name: body.name, channel: body.channel, ...triggerColumns(body.trigger), action: body.action, perHour: body.perHour, enabled: false, createdBy: actor })
      .returning()
    if (!row) throw new Error("Routine insert returned nothing")
    emitRoutine(emit, routineEventTypes.created, actor, row, { trigger: body.trigger.kind, action: body.action.kind })
    return row.id
  })
  return getRoutine(db, id)
}

const editableRoutineFields = ["name", "channel", "trigger", "action", "perHour"] as const

export async function updateRoutine(db: Database, actor: string, id: number, body: UpdateRoutineBody, now = new Date()): Promise<Routine> {
  await mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    const current = await lockRoutine(tx, id)
    const changed = editableRoutineFields.filter((key) => body[key] !== undefined)
    if (body.channel !== undefined) await requireChannel(tx, body.channel)
    if (body.action !== undefined) await checkAction(tx, body.action)
    const trigger = body.trigger ?? triggerOf(current)
    const [row] = await tx
      .update(routines)
      .set({
        name: body.name ?? current.name,
        channel: body.channel ?? current.channel,
        ...triggerColumns(trigger),
        action: body.action ?? current.action,
        perHour: body.perHour ?? current.perHour,
        nextRunAt: body.trigger ? nextRunFor(trigger, current.enabled, now) : current.nextRunAt,
        updatedAt: now,
      })
      .where(eq(routines.id, id))
      .returning()
    if (!row) throw new Error("Routine update returned nothing")
    emitRoutine(emit, routineEventTypes.updated, actor, row, { changed })
  })
  return getRoutine(db, id)
}

async function setEnabled(db: Database, actor: string, id: number, enabled: boolean, now: Date): Promise<Routine> {
  await mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    const current = await lockRoutine(tx, id)
    if (current.enabled === enabled) return
    const [row] = await tx
      .update(routines)
      .set({ enabled, nextRunAt: nextRunFor(triggerOf(current), enabled, now), updatedAt: now })
      .where(eq(routines.id, id))
      .returning()
    if (!row) throw new Error("Routine update returned nothing")
    emitRoutine(emit, enabled ? routineEventTypes.enabled : routineEventTypes.disabled, actor, row)
  })
  return getRoutine(db, id)
}

export const enableRoutine = (db: Database, actor: string, id: number, now = new Date()) => setEnabled(db, actor, id, true, now)
export const disableRoutine = (db: Database, actor: string, id: number, now = new Date()) => setEnabled(db, actor, id, false, now)

export async function deleteRoutine(db: Database, actor: string, id: number): Promise<DeletedRoutine> {
  return mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    const [current] = await tx.select().from(routines).where(eq(routines.id, id)).for("update")
    if (!current) throw notFound(`Routine ${id} does not exist; fc routines lists them`)
    if (current.deletedAt) return { id, deletedAt: current.deletedAt.toISOString() }
    const deletedAt = new Date()
    const [row] = await tx.update(routines).set({ deletedAt, enabled: false, nextRunAt: null, updatedAt: deletedAt }).where(eq(routines.id, id)).returning()
    if (!row) throw new Error("Routine update returned nothing")
    emitRoutine(emit, routineEventTypes.deleted, actor, row)
    return { id, deletedAt: deletedAt.toISOString() }
  })
}

export async function scheduleDueRoutines(db: Database, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(routines)
      .where(and(eq(routines.enabled, true), isNull(routines.deletedAt), eq(routines.triggerKind, "cron"), lte(routines.nextRunAt, now)))
      .orderBy(asc(routines.nextRunAt))
      .for("update", { skipLocked: true })
    let queued = 0
    for (const routine of due) {
      if (!routine.nextRunAt || !routine.schedule) continue
      const cause: JobCause = { kind: "cron", scheduledFor: routine.nextRunAt.toISOString() }
      const key = `routine:${routine.id}:cron:${cause.scheduledFor}`
      if (await enqueueJob(tx, { kind: "routine", key, routineId: routine.id, payload: { cause }, runAt: routine.nextRunAt })) queued++
      await tx.update(routines).set({ nextRunAt: nextRunOf(routine.schedule, now) }).where(eq(routines.id, routine.id))
    }
    return queued
  })
}

async function firedSince(tx: Tx, since: Date, routineId?: number): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.kind, "routine"), eq(jobs.state, "done"), gt(jobs.finishedAt, since), routineId === undefined ? undefined : eq(jobs.routineId, routineId)))
  return row?.n ?? 0
}

async function ensureRoutineActor(tx: Tx, emit: Emit): Promise<void> {
  const [joined] = await tx.insert(members).values({ name: routineActor, kind: "watcher" }).onConflictDoNothing().returning({ name: members.name })
  if (joined) emit({ type: "member.joined", actor: routineActor, data: { name: routineActor, kind: "watcher", owner: null } })
}

async function post(tx: Tx, emit: Emit, channel: string, text: string): Promise<string> {
  const mentions = await mentionsOf(tx, text)
  const row = await insertMessage(tx, { channel, kind: "text", who: routineActor, body: text, mentions })
  emitMessage(emit, "message.posted", row, routineActor, messageKey(row.id), { mentions })
  return messageKey(row.id)
}

async function act(tx: Tx, emit: Emit, routine: RoutineRow, now: Date): Promise<string> {
  const action = RoutineAction.parse(routine.action)
  switch (action.kind) {
    case "post":
      return `posted ${await post(tx, emit, routine.channel, action.text)}`
    case "task": {
      const task = await insertTask(tx, emit, routineActor, { channel: routine.channel, title: action.title, assignee: action.assignee, needs: [], labels: [], kind: "build", spec: null })
      return `created #${task.id}`
    }
    case "mention": {
      const agent = await findMember(tx, action.agent)
      if (!agent || agent.kind !== "agent") throw invalid(`${action.agent} is no longer an agent on this board`)
      return `mentioned ${action.agent} in ${await post(tx, emit, routine.channel, `@${action.agent} ${action.text}`)}`
    }
    case "brief": {
      const brief = await buildBrief(tx, now)
      return `posted the brief as ${await post(tx, emit, routine.channel, brief.text)}`
    }
    default: {
      const never: never = action
      throw invalid(`Unknown action ${JSON.stringify(never)}`)
    }
  }
}

export function actionDetail(action: RoutineAction, channel: string): string {
  switch (action.kind) {
    case "post":
      return `Post in #${channel}: ${action.text}`
    case "task":
      return `Create a task in #${channel}: ${action.title}${action.assignee ? ` (for ${action.assignee})` : ""}`
    case "mention":
      return `Post in #${channel}: @${action.agent} ${action.text}`
    case "brief":
      return `Post the morning brief in #${channel}`
    default: {
      const never: never = action
      throw invalid(`Unknown action ${JSON.stringify(never)}`)
    }
  }
}

interface Firing {
  job: JobRow
  routine: RoutineRow | undefined
  now: Date
}

async function approval(tx: Tx, emit: Emit, job: JobRow, routine: RoutineRow): Promise<JobOutcome | null> {
  const action = RoutineAction.parse(routine.action)
  const kind = routineActionKind[action.kind]
  const label = actionKindRules[kind].label.toLowerCase()
  const verdict = await verdictFor(tx, kind, routine.channel)
  switch (verdict) {
    case "allow":
      return null
    case "block":
      return { state: "skipped", result: `Blocked: the approval rule for ${label} in #${routine.channel} is block` }
    case "ask": {
      if (await allowedOnce(tx, job.id)) return null
      const asked = await askApproval(tx, emit, { job, kind, channel: routine.channel, text: `Routine ${routine.name} wants to ${label}`, detail: actionDetail(action, routine.channel) })
      return { state: "waiting", result: asked }
    }
    default: {
      const never: never = verdict
      throw invalid(`Unknown verdict ${String(never)}`)
    }
  }
}

async function fire(tx: Tx, emit: Emit, { job, routine, now }: Firing): Promise<JobOutcome> {
  if (!routine || routine.deletedAt) return { state: "skipped", result: "The routine was deleted" }
  if (!routine.enabled) return { state: "skipped", result: "The routine is off" }
  const hourAgo = new Date(now.getTime() - 3_600_000)
  if ((await firedSince(tx, hourAgo, routine.id)) >= routine.perHour) return { state: "skipped", result: `Over its limit of ${routine.perHour} runs an hour` }
  if ((await firedSince(tx, hourAgo)) >= routineLimits.totalPerHour) return { state: "skipped", result: `Over the board's limit of ${routineLimits.totalPerHour} routine runs an hour` }
  await ensureRoutineActor(tx, emit)
  const held = await approval(tx, emit, job, routine)
  if (held) return held
  return { state: "done", result: await act(tx, emit, routine, now) }
}

export async function runRoutineJob(db: Database, job: JobRow, now: Date): Promise<void> {
  await mutate(db, async (tx, emit) => {
    if (!(await lockClaimedJob(tx, job))) return
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('flockr.routines'))`)
    const [routine] = job.routineId === null ? [] : await tx.select().from(routines).where(eq(routines.id, job.routineId)).for("update")
    const tagged: Emit = (draft) => emit({ ...draft, data: { ...draft.data, routine: job.routineId } })
    await finishJob(tx, emit, job, await fire(tx, tagged, { job, routine, now }), now)
  })
}
