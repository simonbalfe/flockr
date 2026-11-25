import {
  areaLimits,
  normalizeAreaPath,
  overlappingPaths,
  taskBranch,
  type AreaEndReason,
  type AreaOverlap,
  type DeclareAreaBody,
  type DeclareAreaResult,
  type WorkingArea,
} from "@flockr/contracts"
import { and, asc, eq, gt, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channels, workingAreas, type TaskRow, type WorkingAreaRow } from "../db/schema"
import { areaOverlap, forbidden, invalid, notFound, notHolder, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { requireChannel } from "./read"
import { checkEpoch, lockTask, requireLiveLease, requireState, threadEvent } from "./write"

const areaMs = areaLimits.defaultMinutes * 60_000

const freshExpiry = (now: Date) => new Date(now.getTime() + areaMs)

export function presentArea(row: WorkingAreaRow): WorkingArea {
  return {
    id: row.id,
    channel: row.channel,
    owner: row.owner,
    taskId: row.taskId,
    branch: row.taskId === null ? null : taskBranch(row.taskId),
    paths: row.paths,
    note: row.note,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

const live = (now: Date): SQL => and(isNull(workingAreas.releasedAt), or(isNull(workingAreas.expiresAt), gt(workingAreas.expiresAt, now))) ?? sql`true`

function cleanPaths(raw: readonly string[]): string[] {
  const cleaned = raw.map((path) => {
    const normal = normalizeAreaPath(path)
    if (normal === null) throw invalid(`"${path}" is not a path in the repo: no empty path, no .. and nothing outside it`)
    return normal
  })
  return [...new Set(cleaned)].sort()
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i])

function emitArea(emit: Emit, type: string, row: WorkingAreaRow, actor: string, data: Record<string, unknown> = {}): void {
  emit({ type, actor, channel: row.channel, taskId: row.taskId, threadId: row.taskId === null ? null : String(row.taskId), data: { area: row.id, owner: row.owner, paths: row.paths, ...data } })
}

async function lockRepo(tx: Tx, channel: string): Promise<void> {
  const [row] = await tx.select({ repo: channels.repo }).from(channels).where(eq(channels.id, channel))
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`areas:${row?.repo ?? `#${channel}`}`}))`)
}

async function liveRowsInRepo(db: Executor, channel: string, now: Date): Promise<WorkingAreaRow[]> {
  const [home] = await db.select({ repo: channels.repo }).from(channels).where(eq(channels.id, channel))
  const sameRepo = home?.repo ? eq(channels.repo, home.repo) : undefined
  const rows = await db
    .select({ area: workingAreas })
    .from(workingAreas)
    .innerJoin(channels, eq(channels.id, workingAreas.channel))
    .where(and(live(now), or(eq(workingAreas.channel, channel), sameRepo)))
    .orderBy(asc(workingAreas.id))
  return rows.map((r) => r.area)
}

async function overlapsFor(db: Executor, input: { channel: string; owner: string; paths: string[]; now: Date }): Promise<AreaOverlap[]> {
  const rows = await liveRowsInRepo(db, input.channel, input.now)
  return rows
    .filter((row) => row.owner !== input.owner)
    .flatMap((row) => {
      const paths = overlappingPaths(input.paths, row.paths)
      return paths.length ? [{ area: presentArea(row), paths }] : []
    })
}

export function overlapText(overlaps: AreaOverlap[]): string {
  return overlaps
    .map((o) => {
      const where = o.area.taskId === null ? "no task" : `#${o.area.taskId} on ${o.area.branch}`
      return `${o.paths.map((p) => `${p.yours} meets ${p.theirs}`).join(", ")} (${o.area.owner}, ${where})`
    })
    .join("; ")
}

async function findLiveArea(tx: Tx, channel: string, id: number, now: Date): Promise<WorkingAreaRow> {
  const [row] = await tx
    .select()
    .from(workingAreas)
    .where(and(eq(workingAreas.id, id), eq(workingAreas.channel, channel)))
    .for("update")
  if (!row) throw notFound(`Area ${id} does not exist in #${channel}`)
  if (row.releasedAt === null && row.expiresAt !== null && row.expiresAt <= now) throw wrongState(`Area ${id} ran out; declare it again`)
  return row
}

export async function listAreas(db: Executor, channel: string, now = new Date()): Promise<WorkingArea[]> {
  await requireChannel(db, channel)
  const rows = await db
    .select()
    .from(workingAreas)
    .where(and(eq(workingAreas.channel, channel), live(now)))
    .orderBy(asc(workingAreas.id))
  return rows.map(presentArea)
}

async function taskForDeclare(tx: Tx, input: { channel: string; actor: string; taskId: number; epoch: number | undefined; now: Date }): Promise<TaskRow> {
  const task = await lockTask(tx, input.taskId)
  if (task.channel !== input.channel) throw invalid(`#${task.id} is in #${task.channel}, not #${input.channel}`)
  requireState(task, "claimed")
  checkEpoch(task, input.epoch)
  if (task.holder !== input.actor) throw notHolder(`${input.actor} does not hold #${task.id}${task.holder ? `; ${task.holder} does` : ""}`)
  requireLiveLease(task, input.now)
  return task
}

export async function declareArea(db: Database, actor: string, channel: string, body: DeclareAreaBody, now = new Date()): Promise<DeclareAreaResult> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, channel)
    const paths = cleanPaths(body.paths)
    const task = body.taskId === undefined ? null : await taskForDeclare(tx, { channel, actor, taskId: body.taskId, epoch: body.epoch, now })
    await lockRepo(tx, channel)
    const overlaps = await overlapsFor(tx, { channel, owner: actor, paths, now })
    if (overlaps.length && body.overlap === "refuse") throw areaOverlap(`Not declared: ${overlapText(overlaps)}. Pick other work, ask them, or declare with overlap warn.`)
    const note = body.note?.trim() || null
    const candidates = await tx
      .select()
      .from(workingAreas)
      .where(and(live(now), task ? eq(workingAreas.taskId, task.id) : and(isNull(workingAreas.taskId), eq(workingAreas.owner, actor), eq(workingAreas.channel, channel))))
      .for("update")
    const existing = task ? candidates[0] : candidates.find((row) => sameList(row.paths, paths))
    if (existing) {
      if (sameList(existing.paths, paths) && existing.note === note) {
        if (task) return { area: presentArea(existing), overlaps }
        const [renewed] = await tx.update(workingAreas).set({ expiresAt: freshExpiry(now), updatedAt: now }).where(eq(workingAreas.id, existing.id)).returning()
        if (!renewed) throw notFound(`Area ${existing.id} does not exist`)
        emitArea(emit, "area.renewed", renewed, actor, { expiresAt: renewed.expiresAt?.toISOString() ?? null })
        return { area: presentArea(renewed), overlaps }
      }
      const [changed] = await tx.update(workingAreas).set({ paths, note, updatedAt: now }).where(eq(workingAreas.id, existing.id)).returning()
      if (!changed) throw notFound(`Area ${existing.id} does not exist`)
      if (task) await threadEvent(tx, task, actor, `is now working in ${paths.map((p) => `\`${p}\``).join(", ")}`)
      emitArea(emit, "area.changed", changed, actor, { overlaps: overlaps.length })
      return { area: presentArea(changed), overlaps }
    }
    const [row] = await tx
      .insert(workingAreas)
      .values({ channel, owner: actor, taskId: task?.id ?? null, paths, note, expiresAt: task ? null : freshExpiry(now) })
      .returning()
    if (!row) throw new Error("Area insert returned nothing")
    if (task) await threadEvent(tx, task, actor, `is working in ${paths.map((p) => `\`${p}\``).join(", ")}${overlaps.length ? `; overlaps ${overlapText(overlaps)}` : ""}`)
    emitArea(emit, "area.declared", row, actor, { overlaps: overlaps.map((o) => ({ area: o.area.id, owner: o.area.owner, taskId: o.area.taskId })) })
    return { area: presentArea(row), overlaps }
  })
}

export async function renewArea(db: Database, actor: string, channel: string, id: number, now = new Date()): Promise<WorkingArea> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const row = await findLiveArea(tx, channel, id, now)
    if (row.owner !== actor) throw notHolder(`${row.owner} owns area ${id}, not ${actor}`)
    if (row.releasedAt !== null) throw wrongState(`Area ${id} was released; declare it again`)
    if (row.taskId !== null) throw invalid(`Area ${id} belongs to #${row.taskId} and lives as long as its claim: renew the task`)
    const [renewed] = await tx.update(workingAreas).set({ expiresAt: freshExpiry(now), updatedAt: now }).where(eq(workingAreas.id, id)).returning()
    if (!renewed) throw notFound(`Area ${id} does not exist`)
    emitArea(emit, "area.renewed", renewed, actor, { expiresAt: renewed.expiresAt?.toISOString() ?? null })
    return presentArea(renewed)
  })
}

async function endAreas(tx: Tx, emit: Emit, rows: WorkingAreaRow[], input: { actor: string; reason: AreaEndReason; now: Date }): Promise<void> {
  for (const row of rows) {
    const [ended] = await tx
      .update(workingAreas)
      .set({ releasedAt: input.now, releasedReason: input.reason, updatedAt: input.now })
      .where(and(eq(workingAreas.id, row.id), isNull(workingAreas.releasedAt)))
      .returning()
    if (ended) emitArea(emit, "area.released", ended, input.actor, { reason: input.reason })
  }
}

export async function releaseArea(db: Database, actor: string, channel: string, id: number, now = new Date()): Promise<WorkingArea> {
  return mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const [row] = await tx
      .select()
      .from(workingAreas)
      .where(and(eq(workingAreas.id, id), eq(workingAreas.channel, channel)))
      .for("update")
    if (!row) throw notFound(`Area ${id} does not exist in #${channel}`)
    if (row.owner !== actor && member.kind !== "person") throw forbidden(`${row.owner} owns area ${id}; only they or a person can release it`)
    if (row.releasedAt === null) await endAreas(tx, emit, [row], { actor, reason: "released", now })
    return presentArea({ ...row, releasedAt: row.releasedAt ?? now })
  })
}

export async function releaseTaskAreas(tx: Tx, emit: Emit, task: TaskRow, actor: string, reason: AreaEndReason = "task_ended", now = new Date()): Promise<void> {
  const rows = await tx
    .select()
    .from(workingAreas)
    .where(and(eq(workingAreas.taskId, task.id), isNull(workingAreas.releasedAt)))
    .for("update")
  await endAreas(tx, emit, rows, { actor, reason, now })
}

export async function moveTaskAreas(tx: Tx, emit: Emit, task: TaskRow, input: { actor: string; to: string }): Promise<number[]> {
  const rows = await tx
    .select()
    .from(workingAreas)
    .where(and(eq(workingAreas.taskId, task.id), isNull(workingAreas.releasedAt)))
    .for("update")
  const moved: number[] = []
  for (const row of rows) {
    const [updated] = await tx.update(workingAreas).set({ owner: input.to, updatedAt: new Date() }).where(and(eq(workingAreas.id, row.id), ne(workingAreas.owner, input.to))).returning()
    if (!updated) continue
    moved.push(updated.id)
    emitArea(emit, "area.moved", updated, input.actor, { from: row.owner, to: input.to })
  }
  return moved
}

export async function sweepExpiredAreas(db: Database, now = new Date()): Promise<number[]> {
  return mutate(db, async (tx, emit) => {
    const expired = await tx
      .select()
      .from(workingAreas)
      .where(and(isNull(workingAreas.releasedAt), lt(workingAreas.expiresAt, now)))
      .orderBy(asc(workingAreas.id))
      .for("update", { skipLocked: true })
    await endAreas(tx, emit, expired, { actor: "flockr", reason: "expired", now })
    return expired.map((row) => row.id)
  })
}
