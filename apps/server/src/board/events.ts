import type { BoardEvent } from "@flockr/contracts"
import { and, asc, eq, gt, sql } from "drizzle-orm"
import { boardId, eventChannel } from "../config"
import type { Database, Executor, Tx } from "../db/client"
import { boards, events } from "../db/schema"

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

async function writeEvents(tx: Tx, drafts: EventDraft[]): Promise<void> {
  const [board] = await tx
    .insert(boards)
    .values({ id: boardId, lastSeq: drafts.length })
    .onConflictDoUpdate({ target: boards.id, set: { lastSeq: sql`${boards.lastSeq} + ${drafts.length}` } })
    .returning({ lastSeq: boards.lastSeq })
  if (!board) throw new Error("Board counter missing")
  const first = board.lastSeq - drafts.length + 1
  await tx.insert(events).values(
    drafts.map((draft, i) => ({
      boardId,
      seq: first + i,
      type: draft.type,
      actor: draft.actor,
      channel: draft.channel ?? null,
      taskId: draft.taskId ?? null,
      threadId: draft.threadId ?? null,
      messageId: draft.messageId ?? null,
      data: draft.data ?? {},
    })),
  )
  await tx.execute(sql`select pg_notify(${eventChannel}, ${JSON.stringify({ board: boardId, head: board.lastSeq })})`)
}

export async function headSeq(db: Executor): Promise<number> {
  const [board] = await db.select({ lastSeq: boards.lastSeq }).from(boards).where(eq(boards.id, boardId))
  return board?.lastSeq ?? 0
}

export async function eventsSince(db: Executor, since: number, limit: number): Promise<BoardEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.boardId, boardId), gt(events.seq, since)))
    .orderBy(asc(events.seq))
    .limit(limit)
  return rows.map((row) => ({
    seq: row.seq,
    type: row.type,
    at: row.at.toISOString(),
    actor: row.actor,
    channel: row.channel,
    taskId: row.taskId,
    threadId: row.threadId,
    messageId: row.messageId,
    data: row.data,
  }))
}
