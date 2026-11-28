import { navigationLimits, type SavedItem, type SavedState } from "@flockr/contracts"
import { and, desc, eq } from "drizzle-orm"
import type { Database, Executor } from "../db/client"
import { messages, savedMessages } from "../db/schema"
import { invalid, wrongState } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMessage, messageKey, parseThreadId, threadKeyOf } from "./read"
import { emitMessage } from "./write"
import { viewerOf, visibleTo } from "./visibility"

export async function setSaved(db: Database, actor: string, id: string, saved: boolean): Promise<SavedState> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const ref = parseThreadId(id)
    if (ref.kind === "task") throw invalid(`${id} is a task; only messages and replies can be saved`)
    const message = await findMessage(tx, ref.id)
    if (message.kind !== "text") throw invalid(`${id} is not a message or reply`)
    const key = messageKey(message.id)
    if (saved) {
      if (message.deletedAt) throw wrongState(`${id} was deleted; it cannot be saved`)
      const added = await tx.insert(savedMessages).values({ member: actor, messageId: message.id }).onConflictDoNothing().returning()
      if (added.length) emitMessage(emit, "message.saved", message, actor, threadKeyOf(message))
    } else {
      const removed = await tx.delete(savedMessages).where(and(eq(savedMessages.member, actor), eq(savedMessages.messageId, message.id))).returning()
      if (removed.length) emitMessage(emit, "message.unsaved", message, actor, threadKeyOf(message))
    }
    return { id: key, saved }
  })
}

export async function listSaved(db: Executor, actor: string): Promise<SavedItem[]> {
  const rows = await db
    .select({ row: messages, savedAt: savedMessages.savedAt })
    .from(savedMessages)
    .innerJoin(messages, eq(messages.id, savedMessages.messageId))
    .where(and(eq(savedMessages.member, actor), visibleTo(messages.channel, viewerOf(actor))))
    .orderBy(desc(savedMessages.savedAt), desc(savedMessages.messageId))
    .limit(navigationLimits.saved)
  return rows.map(({ row, savedAt }) => ({
    id: messageKey(row.id),
    channel: row.channel,
    threadId: threadKeyOf(row),
    taskId: row.threadTaskId,
    who: row.who,
    at: row.createdAt.toISOString(),
    text: row.deletedAt ? "" : row.body,
    deleted: row.deletedAt !== null,
    savedAt: savedAt.toISOString(),
  }))
}
