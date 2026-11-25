import {
  activitySeconds,
  activityEventTypes,
  applyActivityUpdates,
  startActivity,
  type ActivityEntry,
  type CreateActivityBody,
  type StopRequest,
  type StopRunBody,
  type UpdateActivityBody,
} from "@flockr/contracts"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { activity, members, messages, type MessageRow } from "../db/schema"
import { setActivity } from "./activity"
import { forbidden, invalid, notFound, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { placeOf, type ThreadPlace } from "./questions"
import { activityEntryOf, findMember, messageKey, parseThreadId } from "./read"
import { insertMessage } from "./write"

export interface ActivityWrite {
  entry: ActivityEntry
  applied: boolean
}

function present(row: MessageRow): ActivityEntry {
  const entry = activityEntryOf(row)
  if (!entry) throw notFound(`${messageKey(row.id)} is not an activity entry`)
  return entry
}

function entryRowId(raw: string): number {
  const ref = parseThreadId(raw)
  if (ref.kind !== "message") throw notFound(`${raw} is not an activity entry id; use a message id such as m41`)
  return ref.id
}

async function lockEntry(tx: Tx, raw: string): Promise<MessageRow> {
  const [row] = await tx.select().from(messages).where(eq(messages.id, entryRowId(raw))).for("update")
  if (!row || row.kind !== "activity") throw notFound(`Activity entry ${raw} does not exist`)
  return row
}

async function keyed(tx: Tx, place: ThreadPlace, who: string, key: string): Promise<MessageRow | undefined> {
  const [row] = await tx
    .select()
    .from(messages)
    .where(and(place.scope, eq(messages.kind, "activity"), eq(messages.who, who), sql`${messages.activity}->>'key' = ${key}`))
    .limit(1)
  return row
}

function emitEntry(emit: Emit, row: MessageRow, actor: string, type: string, data: Record<string, unknown>): void {
  const entry = present(row)
  emit({ type, actor, channel: row.channel, taskId: row.threadTaskId, threadId: entry.threadId, messageId: entry.id, data })
}

async function showWorking(db: Database, entry: ActivityEntry, now: Date): Promise<void> {
  const working = entry.status === "running"
  const [shown] = await db
    .select({ expiresAt: activity.expiresAt })
    .from(activity)
    .where(and(eq(activity.member, entry.who), eq(activity.threadId, entry.threadId)))
  const fresh = shown !== undefined && shown.expiresAt.getTime() - now.getTime() > (activitySeconds * 1000) / 2
  if (working && fresh) return
  if (!working && !shown) return
  await setActivity(db, entry.who, entry.threadId, working, now)
}

export async function createActivityEntry(db: Database, actor: string, threadId: string, body: CreateActivityBody, now = new Date()): Promise<ActivityWrite> {
  const result = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const place = await placeOf(tx, threadId)
    if (body.key) {
      const existing = await keyed(tx, place, actor, body.key)
      if (existing) return { row: existing, applied: false }
    }
    const started = startActivity({ title: body.title, runId: body.runId ?? null, key: body.key ?? null, parts: body.parts }, now.toISOString())
    if (!started.ok) throw invalid(started.error)
    const row = await insertMessage(tx, { channel: place.channel, kind: "activity", who: actor, body: body.title, activity: started.state, ...place.link })
    emitEntry(emit, row, actor, activityEventTypes.posted, { entry: present(row) })
    return { row, applied: true }
  })
  const entry = present(result.row)
  if (result.applied) await showWorking(db, entry, now)
  return { entry, applied: result.applied }
}

export function updateActivityEntry(db: Database, actor: string, id: string, body: UpdateActivityBody, now = new Date()): Promise<ActivityWrite> {
  return writeUpdate(db, { actor, id, body, now, mustBeMember: true })
}

interface EntryUpdate {
  actor: string
  id: string
  body: UpdateActivityBody
  now: Date
  mustBeMember: boolean
}

async function writeUpdate(db: Database, { actor, id, body, now, mustBeMember }: EntryUpdate): Promise<ActivityWrite> {
  const result = await mutate(db, async (tx, emit) => {
    if (mustBeMember) await requireActor(tx, actor)
    const row = await lockEntry(tx, id)
    if (row.who !== actor) throw forbidden(`${actor} may not update ${id}: only its author ${row.who} can`)
    const state = present(row)
    if (body.revision !== undefined && body.revision < state.revision) return { row, applied: false }
    if (body.revision !== undefined && body.revision > state.revision) throw invalid(`${id} is at revision ${state.revision}; you sent ${body.revision}`)
    if (!row.activity) throw notFound(`Activity entry ${id} does not exist`)
    const at = now.toISOString()
    const next = applyActivityUpdates(row.activity, body.updates, at)
    if (!next.ok) throw state.status === "running" ? invalid(next.error) : wrongState(next.error)
    const [updated] = await tx.update(messages).set({ activity: next.state, body: next.state.title }).where(eq(messages.id, row.id)).returning()
    if (!updated) throw new Error("Activity update returned nothing")
    emitEntry(emit, updated, actor, activityEventTypes.updated, { revision: next.state.revision, at, updates: next.applied })
    return { row: updated, applied: true }
  })
  const entry = present(result.row)
  if (result.applied) await showWorking(db, entry, now)
  return { entry, applied: result.applied }
}

export async function endRunsOf(db: Database, members: string[], now = new Date()): Promise<string[]> {
  if (!members.length) return []
  const rows = await db
    .select({ id: messages.id, who: messages.who })
    .from(messages)
    .where(and(eq(messages.kind, "activity"), inArray(messages.who, members), sql`${messages.activity}->>'status' = 'running'`))
  const ended: string[] = []
  for (const row of rows) {
    const id = messageKey(row.id)
    try {
      const result = await writeUpdate(db, { actor: row.who, id, body: { updates: [{ type: "run.finished", status: "stopped" }] }, now, mustBeMember: false })
      if (result.applied) ended.push(id)
    } catch (error: unknown) {
      console.error(`could not end run ${id} of ${row.who}`, error)
    }
  }
  return ended
}

export async function getActivityEntry(db: Database, id: string): Promise<ActivityEntry> {
  const [row] = await db.select().from(messages).where(eq(messages.id, entryRowId(id)))
  if (!row || row.kind !== "activity") throw notFound(`Activity entry ${id} does not exist`)
  return present(row)
}

async function mayStop(tx: Tx, actor: string, member: string): Promise<void> {
  const me = await requireActor(tx, actor)
  const target = await findMember(tx, member)
  if (!target) throw notFound(`Member ${member} does not exist`)
  if (me.kind === "person" || me.name === member || target.owner === me.name) return
  throw forbidden(`${actor} may not stop ${member}: only a person, ${member} itself or its owner can`)
}

export async function stopRun(db: Database, actor: string, threadId: string, body: StopRunBody, now = new Date()): Promise<StopRequest[]> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const place = await placeOf(tx, threadId)
    const running = await tx
      .select()
      .from(messages)
      .where(and(place.scope, eq(messages.kind, "activity"), sql`${messages.activity}->>'status' = 'running'`))
      .orderBy(asc(messages.id))
      .for("update")
    const presence = await tx.select({ member: activity.member }).from(activity).where(eq(activity.threadId, place.key))
    const working = [...new Set([...running.map((r) => r.who), ...presence.map((p) => p.member)])]
    const targets = body.member ? [body.member] : working
    if (!targets.length) throw wrongState(`Nobody is working in thread ${place.key}`)
    const known = new Set((await tx.select({ name: members.name }).from(members)).map((m) => m.name))
    const at = now.toISOString()
    const requests: StopRequest[] = []
    for (const member of targets) {
      if (!known.has(member)) throw notFound(`Member ${member} does not exist`)
      await mayStop(tx, actor, member)
      const rows = running.filter((r) => r.who === member)
      const fresh = rows.filter((r) => r.activity && r.activity.stopRequestedAt === null)
      const repeated = rows.length > 0 && fresh.length === 0
      const entryIds = rows.map((r) => messageKey(r.id))
      if (!repeated) {
        for (const row of fresh) {
          if (!row.activity) continue
          await tx.update(messages).set({ activity: { ...row.activity, stopRequestedAt: at } }).where(eq(messages.id, row.id))
        }
        emit({
          type: activityEventTypes.stopRequested,
          actor,
          channel: place.channel,
          taskId: place.taskId,
          threadId: place.key,
          messageId: entryIds.at(-1) ?? null,
          data: { member, reason: body.reason ?? null, entryIds, at },
        })
      }
      requests.push({ member, threadId: place.key, entryIds, requestedBy: actor, at, repeated })
    }
    return requests
  })
}
