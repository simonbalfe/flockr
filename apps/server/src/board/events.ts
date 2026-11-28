import { actorFields, type BoardEvent } from "@flockr/contracts"
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import { boardId } from "../config"
import type { Database, Executor, Tx } from "../db/client"
import { boards, events, members } from "../db/schema"
import { liveSignals } from "../platform"
import { enqueueBridgeJobs } from "./bridge-outbox"
import { enqueueWatchers } from "./watchers"
import { sameOrgChannel, visibleTo, type Viewer } from "./visibility"

export interface EventDraft {
  type: string
  actor: string
  channel?: string | null
  taskId?: number | null
  threadId?: string | null
  messageId?: string | null
  data?: Record<string, unknown>
}

export type Emit = (draft: EventDraft) => void

export async function mutate<T>(db: Database, run: (tx: Tx, emit: Emit) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const drafts: EventDraft[] = []
    const result = await run(tx, (draft) => void drafts.push(draft))
    if (drafts.length) await writeEvents(tx, drafts)
    return result
  })
}

async function actorsOf(tx: Tx, drafts: EventDraft[]): Promise<Map<string, Record<string, string>>> {
  const names = [...new Set(drafts.map((draft) => draft.actor))]
  const rows = await tx.select({ name: members.name, org: members.org, kind: members.kind }).from(members).where(inArray(members.name, names))
  return new Map(rows.map((row) => [row.name, { [actorFields.org]: row.org, [actorFields.kind]: row.kind }]))
}

async function writeEvents(tx: Tx, drafts: EventDraft[]): Promise<void> {
  const [board] = await tx
    .insert(boards)
    .values({ id: boardId, lastSeq: drafts.length })
    .onConflictDoUpdate({ target: boards.id, set: { lastSeq: sql`${boards.lastSeq} + ${drafts.length}` } })
    .returning({ lastSeq: boards.lastSeq })
  if (!board) throw new Error("Board counter missing")
  const first = board.lastSeq - drafts.length + 1
  const actors = await actorsOf(tx, drafts)
  const rows = drafts.map((draft, i) => ({
    boardId,
    seq: first + i,
    type: draft.type,
    actor: draft.actor,
    channel: draft.channel ?? null,
    taskId: draft.taskId ?? null,
    threadId: draft.threadId ?? null,
    messageId: draft.messageId ?? null,
    data: { ...(draft.data ?? {}), ...actors.get(draft.actor) },
  }))
  await tx.insert(events).values(rows)
  await enqueueWatchers(tx, rows)
  await enqueueBridgeJobs(tx, rows)
  await liveSignals.publish(tx, { kind: "head", board: boardId, head: board.lastSeq })
}

export async function headSeq(db: Executor): Promise<number> {
  const [board] = await db.select({ lastSeq: boards.lastSeq }).from(boards).where(eq(boards.id, boardId))
  return board?.lastSeq ?? 0
}

const routingFields = ["mentions", "direct", "member", "state", actorFields.org, actorFields.kind] as const

export type EventViewer = { kind: "member"; viewer: Viewer } | { kind: "live"; viewer: Viewer }

export async function eventsSince(db: Executor, since: number, limit: number, reader: EventViewer): Promise<BoardEvent[]> {
  const rows = await db
    .select({
      row: events,
      allowed: sql<boolean>`${visibleTo(events.channel, reader.viewer)}`,
      ownOrg: sql<boolean>`${sameOrgChannel(events.channel, reader.viewer)}`,
    })
    .from(events)
    .where(and(eq(events.boardId, boardId), gt(events.seq, since)))
    .orderBy(asc(events.seq))
    .limit(limit)
  return rows.flatMap(({ row, allowed, ownOrg }): BoardEvent[] => {
    if (!allowed && !(reader.kind === "live" && ownOrg)) return []
    const data = allowed ? row.data : Object.fromEntries(routingFields.flatMap((key) => (key in row.data ? [[key, row.data[key]]] : [])))
    return [{ seq: row.seq, type: row.type, at: row.at.toISOString(), actor: row.actor, channel: row.channel, taskId: row.taskId, threadId: row.threadId, messageId: row.messageId, data }]
  })
}
