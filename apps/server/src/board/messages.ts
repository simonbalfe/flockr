import {
  labelSet,
  mayDeleteMessage,
  mayEditMessage,
  mayLabelMessage,
  mentionsIn,
  sameLabels,
  type DeletedMessage,
  type EditMessageBody,
  type MessageState,
  type PostableBlock,
  type Reply,
  type TextMessage,
} from "@flockr/contracts"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { members, messages, messageVersions, type MemberRow, type MessageRow } from "../db/schema"
import { addressedIn, seenIn } from "./direct"
import { clearDraft } from "./drafts"
import { alreadyExists, forbidden, invalid, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { findMember, findMessage, findMessageForUpdate, getThread, messageKey, parseThreadId, replyOf, requireChannel, threadKeyOf } from "./read"
import { checkEpoch, emitMessage, insertMessage, lockTask } from "./write"

export async function mentionsOf(tx: Tx, text: string): Promise<string[]> {
  const names = await tx.select({ name: members.name }).from(members).where(isNull(members.removedAt))
  return mentionsIn(text, new Set(names.map((m) => m.name)))
}

interface Said {
  text: string
  labels: string[]
  key?: string | undefined
  blocks?: PostableBlock[] | undefined
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))

async function priorPost(tx: Tx, actor: string, said: Said): Promise<MessageRow | null> {
  if (said.key === undefined) return null
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`post:${actor}:${said.key}`}))`)
  const [prior] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.who, actor), eq(messages.requestKey, said.key)))
  if (!prior) return null
  if (prior.body !== said.text || canonical(prior.blocks) !== canonical(said.blocks ?? [])) throw alreadyExists(`Key ${said.key} was already used for ${messageKey(prior.id)} with other text; use a new key for a new message`)
  return prior
}

export async function postMessage(db: Database, actor: string, channel: string, said: Said): Promise<{ message: TextMessage }> {
  const row = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, channel)
    const prior = await priorPost(tx, actor, said)
    if (prior) return prior
    const { mentions, direct } = await addressedIn(tx, { channel, actor, mentions: await mentionsOf(tx, said.text) })
    const labels = labelSet(said.labels)
    const created = await insertMessage(tx, { channel, kind: "text", who: actor, body: said.text, mentions, labels, requestKey: said.key ?? null, blocks: said.blocks ?? [] })
    emitMessage(emit, "message.posted", created, actor, messageKey(created.id), { mentions, labels, ...(direct ? { direct } : {}) })
    await clearDraft(tx, { member: actor, kind: "channel", target: channel })
    return created
  })
  const thread = await getThread(db, messageKey(row.id))
  if (!thread.root) throw new Error("Posted message has no root")
  return { message: thread.root }
}

interface ReplyDraft extends Said {
  epoch?: number | undefined
}

async function replyUnder(tx: Tx, emit: Emit, options: { actor: string; parent: MessageRow; draft: ReplyDraft; said: string[] }): Promise<MessageRow> {
  const { actor, parent, draft } = options
  if (parent.kind !== "text") throw invalid(`${messageKey(parent.id)} is not a reply; reply to a message, a reply or a task`)
  const { mentions, direct } = await addressedIn(tx, { channel: parent.channel, actor, mentions: options.said })
  const anchor = parent.replyToId ?? parent.id
  const data = { mentions, labels: labelSet(draft.labels), replyTo: messageKey(anchor), ...(direct ? { direct } : {}) }
  const base = { channel: parent.channel, kind: "text" as const, who: actor, body: draft.text, mentions, labels: data.labels, replyToId: anchor, requestKey: draft.key ?? null, blocks: draft.blocks ?? [] }
  if (parent.threadTaskId !== null) {
    const task = await lockTask(tx, parent.threadTaskId)
    checkEpoch(task, draft.epoch)
    const created = await insertMessage(tx, { ...base, threadTaskId: task.id })
    emitMessage(emit, "reply.posted", created, actor, String(task.id), data)
    return created
  }
  const created = await insertMessage(tx, { ...base, parentId: parent.parentId })
  emitMessage(emit, "reply.posted", created, actor, threadKeyOf(created), data)
  return created
}

export async function reply(db: Database, actor: string, threadId: string, draft: ReplyDraft): Promise<Reply> {
  const row: MessageRow = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const ref = parseThreadId(threadId)
    const prior = await priorPost(tx, actor, draft)
    if (prior) return prior
    const said = await mentionsOf(tx, draft.text)
    const labels = labelSet(draft.labels)
    const draftKey = { member: actor, kind: "thread" as const, target: ref.kind === "task" ? String(ref.id) : messageKey(ref.id) }
    if (ref.kind === "task") {
      const task = await lockTask(tx, ref.id)
      checkEpoch(task, draft.epoch)
      const { mentions, direct } = await addressedIn(tx, { channel: task.channel, actor, mentions: said })
      const created = await insertMessage(tx, { channel: task.channel, kind: "text", who: actor, body: draft.text, mentions, labels, threadTaskId: task.id, requestKey: draft.key ?? null, blocks: draft.blocks ?? [] })
      emitMessage(emit, "reply.posted", created, actor, String(task.id), { mentions, labels, ...(direct ? { direct } : {}) })
      await clearDraft(tx, draftKey)
      return created
    }
    const parent = await findMessage(tx, ref.id)
    if (parent.parentId !== null || parent.threadTaskId !== null) {
      const created = await replyUnder(tx, emit, { actor, parent, draft, said })
      await clearDraft(tx, draftKey)
      return created
    }
    if (parent.kind !== "text") throw invalid(`${threadId} is not a message; reply to a message or a task`)
    const { mentions, direct } = await addressedIn(tx, { channel: parent.channel, actor, mentions: said })
    const created = await insertMessage(tx, { channel: parent.channel, kind: "text", who: actor, body: draft.text, mentions, labels, parentId: parent.id, requestKey: draft.key ?? null, blocks: draft.blocks ?? [] })
    emitMessage(emit, "reply.posted", created, actor, messageKey(parent.id), { mentions, labels, ...(direct ? { direct } : {}) })
    await clearDraft(tx, draftKey)
    return created
  })
  return replyOf(row)
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

async function editText(tx: Tx, emit: Emit, options: { actor: MemberRow; message: MessageRow; text: string }): Promise<MessageRow> {
  const { actor, message, text } = options
  if (!mayEditMessage({ actor, author: message.who })) throw forbidden(`${actor.name} may not edit ${messageKey(message.id)}: only its author, ${message.who}, can`)
  if (text === message.body) return message
  const [earlier] = await tx.select({ n: count() }).from(messageVersions).where(eq(messageVersions.messageId, message.id))
  const replaced = (earlier?.n ?? 0) + 1
  await tx.insert(messageVersions).values({ messageId: message.id, version: replaced, body: message.body, mentions: message.mentions, writtenAt: message.editedAt ?? message.createdAt })
  const mentions = await seenIn(tx, message.channel, await mentionsOf(tx, text))
  const [edited] = await tx.update(messages).set({ body: text, mentions, editedAt: new Date() }).where(eq(messages.id, message.id)).returning()
  if (!edited) throw new Error("Message update returned nothing")
  emitMessage(emit, "message.edited", edited, actor.name, threadKeyOf(edited), { text, mentions, version: replaced + 1 })
  return edited
}

async function editLabels(tx: Tx, emit: Emit, options: { actor: MemberRow; message: MessageRow; labels: string[] }): Promise<MessageRow> {
  const { actor, message } = options
  const author = await findMember(tx, message.who)
  if (!mayLabelMessage({ actor, author: message.who, authorOwner: author?.owner ?? null })) {
    throw forbidden(`${actor.name} may not label ${messageKey(message.id)}: only its author, the author's owner or a person can`)
  }
  const labels = labelSet(options.labels)
  if (sameLabels(labels, message.labels)) return message
  const [labeled] = await tx.update(messages).set({ labels }).where(eq(messages.id, message.id)).returning()
  if (!labeled) throw new Error("Message update returned nothing")
  const added = labels.filter((l) => !message.labels.includes(l))
  const removed = message.labels.filter((l) => !labels.includes(l))
  emitMessage(emit, "message.labeled", labeled, actor.name, threadKeyOf(labeled), { labels, added, removed })
  return labeled
}

export async function editMessage(db: Database, actor: string, id: string, body: EditMessageBody): Promise<MessageState> {
  const { row, version } = await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const ref = parseThreadId(id)
    if (ref.kind === "task") throw wrongState(`${id} is a task; only messages can be edited`)
    let message = await findMessageForUpdate(tx, ref.id)
    if (message.kind !== "text") throw wrongState(`${id} is a ${cardName[message.kind]}; only messages and replies can be edited`)
    if (message.deletedAt) throw wrongState(`${id} was deleted; it cannot be edited`)
    if (body.text !== undefined) message = await editText(tx, emit, { actor: member, message, text: body.text })
    if (body.labels !== undefined) message = await editLabels(tx, emit, { actor: member, message, labels: body.labels })
    const [earlier] = await tx.select({ n: count() }).from(messageVersions).where(eq(messageVersions.messageId, message.id))
    return { row: message, version: (earlier?.n ?? 0) + 1 }
  })
  return {
    id: messageKey(row.id),
    channel: row.channel,
    threadId: threadKeyOf(row),
    who: row.who,
    text: row.body,
    mentions: row.mentions,
    labels: row.labels,
    editedAt: row.editedAt?.toISOString() ?? null,
    version,
  }
}
