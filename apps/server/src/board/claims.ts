import { leaseMinutes, type ClaimNextBody, type ReleaseBody, type Task } from "@flockr/contracts"
import { and, arrayContains, asc, eq, isNull, lt, or, type SQL } from "drizzle-orm"
import { viewerOf, visibleTo } from "./visibility"
import type { Database, Tx } from "../db/client"
import { tasks, type TaskRow } from "../db/schema"
import { releaseTaskAreas } from "./areas"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { getTask } from "./read"
import { channelEvent, emitTask, lockTask, requireClaimable, requireHolder, requireLiveLease, requireState, threadEvent, updateTask } from "./write"

const leaseMs = leaseMinutes * 60_000

export const leaseFromNow = () => new Date(Date.now() + leaseMs)

async function takeClaim(tx: Tx, emit: Emit, task: TaskRow, actor: string): Promise<TaskRow> {
  const row = await updateTask(tx, task.id, {
    state: "claimed",
    holder: actor,
    leaseExpiresAt: leaseFromNow(),
    claimEpoch: task.claimEpoch + 1,
    reason: null,
  })
  await channelEvent(tx, row.channel, actor, `claimed #${row.id}`)
  await threadEvent(tx, row, actor, `claimed this task, ${leaseMinutes} min lease`)
  emitTask(emit, "task.claimed", row, actor, { holder: actor, epoch: row.claimEpoch })
  return row
}

export async function claimNext(db: Database, actor: string, body: ClaimNextBody & { channels?: string[] | null }): Promise<Task | null> {
  const id = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const filters: SQL[] = [eq(tasks.state, "ready")]
    const open = body.mine ? eq(tasks.assignee, actor) : or(isNull(tasks.assignee), eq(tasks.assignee, actor))
    if (open) filters.push(open)
    if (body.labels.length) filters.push(arrayContains(tasks.labels, body.labels))
    filters.push(visibleTo(tasks.channel, viewerOf(actor, body.channels ?? null)))
    const [candidate] = await tx
      .select()
      .from(tasks)
      .where(and(...filters))
      .orderBy(asc(tasks.createdAt), asc(tasks.id))
      .limit(1)
      .for("update", { skipLocked: true })
    if (!candidate) return null
    return (await takeClaim(tx, emit, candidate, actor)).id
  })
  return id === null ? null : getTask(db, id)
}

export async function claimTask(db: Database, actor: string, id: number): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "ready")
    requireClaimable(task, member)
    await takeClaim(tx, emit, task, actor)
  })
  return getTask(db, id)
}

export async function renewTask(db: Database, actor: string, id: number, epoch: number | undefined): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, epoch)
    requireLiveLease(task)
    const row = await updateTask(tx, id, { leaseExpiresAt: leaseFromNow() })
    emitTask(emit, "task.renewed", row, actor, { leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null })
  })
  return getTask(db, id)
}

export async function releaseTask(db: Database, actor: string, id: number, body: ReleaseBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    const declines = task.assignee === actor && !body.keepAssignee
    if (task.state === "ready" && declines) {
      const row = await updateTask(tx, id, { assignee: null })
      await threadEvent(tx, row, actor, "declined this task")
      emitTask(emit, "task.released", row, actor, { holder: null, declined: true })
      return
    }
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    const holder = task.holder ?? actor
    const row = await updateTask(tx, id, { state: "ready", holder: null, leaseExpiresAt: null, question: null, ...(declines ? { assignee: null } : {}) })
    await releaseTaskAreas(tx, emit, row, actor)
    await threadEvent(tx, row, holder, declines ? "released and declined this task" : "released this task")
    emitTask(emit, "task.released", row, actor, { holder, declined: declines })
  })
  return getTask(db, id)
}

export async function sweepExpiredClaims(db: Database, now = new Date()): Promise<number[]> {
  return mutate(db, async (tx, emit) => {
    const expired = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.state, "claimed"), lt(tasks.leaseExpiresAt, now), isNull(tasks.question)))
      .orderBy(asc(tasks.id))
      .for("update", { skipLocked: true })
    for (const task of expired) {
      const holder = task.holder ?? "flockr"
      const row = await updateTask(tx, task.id, { state: "ready", holder: null, leaseExpiresAt: null })
      await releaseTaskAreas(tx, emit, row, holder, "expired")
      await channelEvent(tx, row.channel, holder, `lease ran out on #${row.id}, back to ready`)
      emitTask(emit, "task.expired", row, holder, { holder: task.holder, epoch: task.claimEpoch })
    }
    return expired.map((t) => t.id)
  })
}
