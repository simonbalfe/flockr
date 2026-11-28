import { answerRefusal, type ThreadAskBody, type ThreadQuestion } from "@flockr/contracts"
import { and, desc, eq, isNull, type SQL } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { messages, type MessageRow } from "../db/schema"
import { settleJobApproval } from "./approvals"
import { forbidden, invalid, wrongState } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember, findMessageForUpdate, messageKey, parseThreadId, questionOf } from "./read"
import { requireSeesTask } from "./tasks"
import { insertMessage, lockTask } from "./write"

export interface ThreadPlace {
  channel: string
  taskId: number | null
  key: string
  link: { parentId: number } | { threadTaskId: number }
  scope: SQL | undefined
}

export async function placeOf(tx: Tx, threadId: string): Promise<ThreadPlace> {
  const ref = parseThreadId(threadId)
  if (ref.kind === "task") {
    const task = await lockTask(tx, ref.id)
    return { channel: task.channel, taskId: task.id, key: String(task.id), link: { threadTaskId: task.id }, scope: eq(messages.threadTaskId, task.id) }
  }
  const root = await findMessageForUpdate(tx, ref.id)
  if (root.parentId !== null || root.threadTaskId !== null) throw invalid(`${threadId} is itself a reply; ask in its thread instead`)
  if (root.kind !== "text") throw invalid(`${threadId} is not a message; ask in a message or task thread`)
  return { channel: root.channel, taskId: null, key: messageKey(root.id), link: { parentId: root.id }, scope: eq(messages.parentId, root.id) }
}

async function openQuestion(tx: Tx, place: ThreadPlace): Promise<MessageRow | undefined> {
  const [row] = await tx
    .select()
    .from(messages)
    .where(and(place.scope, eq(messages.kind, "question"), isNull(messages.answer), isNull(messages.deletedAt)))
    .orderBy(desc(messages.id))
    .limit(1)
    .for("update")
  return row
}

function present(row: MessageRow): ThreadQuestion {
  const question = questionOf(row)
  if (!question) throw new Error(`Message ${messageKey(row.id)} is not a question`)
  return question
}

export async function askInThread(db: Database, actor: string, threadId: string, body: ThreadAskBody): Promise<ThreadQuestion> {
  const row = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const place = await placeOf(tx, threadId)
    const to = body.to ?? null
    if (to !== null) {
      if (to === actor) throw invalid("Ask someone else; a question to yourself has nobody to answer it")
      if (!(await findMember(tx, to))) throw invalid(`Member ${to} does not exist`)
      await requireSeesTask(tx, to, place.channel)
    }
    if (await openQuestion(tx, place)) throw wrongState(`Thread ${place.key} already has an open question; wait for its answer first`)
    const question = { text: body.text, detail: body.detail, options: body.options, ...(body.action ? { action: body.action } : {}) }
    const created = await insertMessage(tx, { channel: place.channel, kind: "question", who: actor, body: body.text, question, askedTo: to, ...place.link })
    emit({ type: "question.asked", actor, channel: place.channel, taskId: place.taskId, threadId: place.key, messageId: messageKey(created.id), data: { question, to } })
    return created
  })
  return present(row)
}

export async function answerInThread(db: Database, actor: string, threadId: string, option: string): Promise<ThreadQuestion> {
  const row = await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const place = await placeOf(tx, threadId)
    const open = await openQuestion(tx, place)
    const question = open?.question
    if (!open || !question) throw invalid(`Thread ${place.key} has no open question`)
    const refusal = answerRefusal({ actor: member, question: { to: open.askedTo, permission: question.action !== undefined } })
    if (refusal) throw forbidden(refusal)
    if (!question.options.includes(option)) throw invalid(`Answer with one of: ${question.options.join(", ")}`)
    const now = new Date()
    const [answered] = await tx.update(messages).set({ answer: option, answeredBy: actor, answeredAt: now }).where(eq(messages.id, open.id)).returning()
    if (!answered) throw new Error("Question update returned nothing")
    await insertMessage(tx, { channel: place.channel, kind: "text", who: actor, body: `${option}.`, ...place.link })
    emit({
      type: "question.answered",
      actor,
      channel: place.channel,
      taskId: place.taskId,
      threadId: place.key,
      messageId: messageKey(answered.id),
      data: { option, question: question.text, to: open.askedTo },
    })
    await settleJobApproval(tx, emit, { questionId: answered.id, option, by: actor, now })
    return answered
  })
  return present(row)
}
