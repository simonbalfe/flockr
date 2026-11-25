import { mayDeleteMessage, mentionsIn, type DeletedMessage, type Reply, type TextMessage } from "@flockr/contracts"
import { eq, isNull } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { members, messages, type MessageRow } from "../db/schema"
import { forbidden, invalid, wrongState } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember, findMessage, findMessageForUpdate, getThread, messageKey, parseThreadId, requireChannel, threadKeyOf } from "./read"
import { checkEpoch, emitMessage, insertMessage, lockTask } from "./write"

async function mentionsOf(tx: Tx, text: string): Promise<string[]> {
  const names = await tx.select({ name: members.name }).from(members).where(isNull(members.removedAt))
  return mentionsIn(text, new Set(names.map((m) => m.name)))
}

export async function postMessage(db: Database, actor: string, channel: string, text: string): Promise<{ message: TextMessage }> {
  const row = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, channel)
    const mentions = await mentionsOf(tx, text)
    const created = await insertMessage(tx, { channel, kind: "text", who: actor, body: text, mentions })
    emitMessage(emit, "message.posted", created, actor, messageKey(created.id), { mentions })
    return created
  })
  const thread = await getThread(db, messageKey(row.id))
  if (!thread.root) throw new Error("Posted message has no root")
  return { message: thread.root }
}

export async function reply(db: Database, actor: string, threadId: string, text: string, epoch: number | undefined): Promise<Reply> {
  const row: MessageRow = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const ref = parseThreadId(threadId)
    const mentions = await mentionsOf(tx, text)
    if (ref.kind === "task") {
      const task = await lockTask(tx, ref.id)
      checkEpoch(task, epoch)
      const created = await insertMessage(tx, { channel: task.channel, kind: "text", who: actor, body: text, mentions, threadTaskId: task.id })
      emitMessage(emit, "reply.posted", created, actor, String(task.id), { mentions })
      return created
    }
    const parent = await findMessage(tx, ref.id)
    if (parent.parentId !== null || parent.threadTaskId !== null) throw invalid(`${threadId} is itself a reply; reply to its thread instead`)
    if (parent.kind !== "text") throw invalid(`${threadId} is not a message; reply to a message or a task`)
    const created = await insertMessage(tx, { channel: parent.channel, kind: "text", who: actor, body: text, mentions, parentId: parent.id })
    emitMessage(emit, "reply.posted", created, actor, messageKey(parent.id), { mentions })
    return created
  })
  return { kind: "reply", id: messageKey(row.id), who: row.who, at: row.createdAt.toISOString(), text: row.body, deleted: false, mentions: row.mentions }
}

const cardName = { text: "message", task: "task card", ask: "question card", event: "system event", question: "question", activity: "activity entry" } as const satisfies Record<MessageRow["kind"], string>

export async function deleteMessage(db: Database, actor: string, id: string): Promise<DeletedMessage> {
  const row = await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const ref = parseThreadId(id)
    if (ref.kind === "task") throw wrongState(`${id} is a task; only messages can be deleted`)
    const message = await findMessageForUpdate(tx, ref.id)
    if (message.kind !== "text") throw wrongState(`${id} is a ${cardName[message.kind]}; only messages and replies can be deleted`)
    const author = await findMember(tx, message.who)
    if (!mayDeleteMessage({ actor: member, author: message.who, authorOwner: author?.owner ?? null })) throw forbidden(`${actor} may not delete ${id}: only its author, the author's owner or a person can`)
    if (message.deletedAt) return message
    const [deleted] = await tx.update(messages).set({ deletedAt: new Date(), deletedBy: actor }).where(eq(messages.id, message.id)).returning()
    if (!deleted) throw new Error("Message update returned nothing")
    emitMessage(emit, "message.deleted", deleted, actor, threadKeyOf(deleted))
    return deleted
  })
  return { id: messageKey(row.id), channel: row.channel, deletedBy: row.deletedBy ?? actor, deletedAt: (row.deletedAt ?? new Date()).toISOString() }
}
