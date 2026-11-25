import { shortSha, type AskBody, type CompleteBody, type Task } from "@flockr/contracts"
import { and, arrayContains, asc, eq, inArray } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { tasks, type TaskRow } from "../db/schema"
import { latestCommit, recordCommit } from "./commits"
import { invalid } from "./errors"
import { leaseFromNow } from "./claims"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { getTask } from "./read"
import { channelEvent, emitTask, feedCard, feedText, lockTask, requireHolder, requireState, taskReply, threadEvent, updateTask } from "./write"

async function startReadyTasks(tx: Tx, emit: Emit, finished: TaskRow, actor: string): Promise<void> {
  const waiting = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.state, "waiting"), arrayContains(tasks.needs, [finished.id])))
    .orderBy(asc(tasks.id))
    .for("update")
  for (const task of waiting) {
    const needed = await tx.select({ state: tasks.state }).from(tasks).where(inArray(tasks.id, task.needs))
    if (needed.length !== task.needs.length || needed.some((n) => n.state !== "done")) continue
    const row = await updateTask(tx, task.id, { state: "ready" })
    await channelEvent(tx, row.channel, actor, `#${row.id} is ready: everything it needs is done`, true)
    emitTask(emit, "task.ready", row, actor, { assignee: row.assignee, after: finished.id })
  }
}

async function finish(tx: Tx, emit: Emit, task: TaskRow, actor: string, type: string, threadText: string, channelText: string, commit?: string): Promise<void> {
  if (commit) await recordCommit(tx, emit, task, actor, { sha: commit })
  const row = await updateTask(tx, task.id, { state: "done", leaseExpiresAt: null, question: null, reason: null })
  await threadEvent(tx, row, actor, threadText)
  await channelEvent(tx, row.channel, actor, channelText)
  emitTask(emit, type, row, actor, { commit: commit ?? (await latestCommit(tx, row.id)) })
  await startReadyTasks(tx, emit, row, actor)
}

export async function completeTask(db: Database, actor: string, id: number, body: CompleteBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    if (body.note?.trim()) await taskReply(tx, task, actor, body.note.trim())
    await finish(tx, emit, task, actor, "task.completed", "completed this task", `completed #${id}`, body.commit)
  })
  return getTask(db, id)
}

export async function submitForReview(db: Database, actor: string, id: number, body: CompleteBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    if (body.commit) await recordCommit(tx, emit, task, actor, { sha: body.commit })
    const commit = body.commit ?? (await latestCommit(tx, id))
    const note = body.note?.trim() || (commit ? `Done in \`${shortSha(commit)}\`. Ready for review.` : "Done. Ready for review.")
    await taskReply(tx, task, actor, note)
    const row = await updateTask(tx, id, { state: "review", leaseExpiresAt: null, question: null })
    await feedText(tx, row.channel, actor, `Finished #${id}, ready for review.`, id)
    emitTask(emit, "task.submitted", row, actor, { commit })
  })
  return getTask(db, id)
}

export async function approveTask(db: Database, actor: string, id: number): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "review")
    await finish(tx, emit, task, actor, "task.approved", "approved and completed this task", `approved #${id}`)
  })
  return getTask(db, id)
}

export async function requestChanges(db: Database, actor: string, id: number, note: string | undefined): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "review")
    const row = await updateTask(tx, id, { state: "claimed", leaseExpiresAt: leaseFromNow() })
    await taskReply(tx, row, actor, note?.trim() || "A couple of changes, see the thread.")
    emitTask(emit, "task.changes_requested", row, actor, { holder: row.holder })
  })
  return getTask(db, id)
}

export async function failTask(db: Database, actor: string, id: number, reason: string, epoch: number | undefined): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, epoch)
    const row = await updateTask(tx, id, { state: "blocked", holder: null, leaseExpiresAt: null, question: null, reason: `Failed: ${reason}` })
    await threadEvent(tx, row, actor, `failed this task: ${reason}`)
    await channelEvent(tx, row.channel, actor, `failed #${id}: ${reason}`)
    emitTask(emit, "task.failed", row, actor, { reason })
  })
  return getTask(db, id)
}

export async function blockTask(db: Database, actor: string, id: number, reason: string, epoch: number | undefined): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "ready", "claimed")
    if (task.state === "claimed") requireHolder(task, member, epoch)
    const row = await updateTask(tx, id, { state: "blocked", leaseExpiresAt: null, reason })
    await threadEvent(tx, row, actor, `blocked this task: ${reason}`)
    await channelEvent(tx, row.channel, actor, `blocked #${id}: ${reason}`)
    emitTask(emit, "task.blocked", row, actor, { reason })
  })
  return getTask(db, id)
}

export async function unblockTask(db: Database, actor: string, id: number): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "blocked")
    const row = await updateTask(tx, id, task.holder ? { state: "claimed", reason: null, leaseExpiresAt: leaseFromNow() } : { state: "ready", reason: null })
    await threadEvent(tx, row, actor, "unblocked this task")
    emitTask(emit, "task.unblocked", row, actor, { holder: row.holder })
  })
  return getTask(db, id)
}

export async function askQuestion(db: Database, actor: string, id: number, body: AskBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    const question = { text: body.text, detail: body.detail, options: body.options, ...(body.action ? { action: body.action } : {}) }
    if (body.note?.trim()) await taskReply(tx, task, actor, body.note.trim())
    const row = await updateTask(tx, id, { question })
    await feedCard(tx, row, actor, "ask")
    emitTask(emit, "task.asked", row, actor, { question })
  })
  return getTask(db, id)
}

export async function answerQuestion(db: Database, actor: string, id: number, option: string): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    const question = task.question
    if (!question) throw invalid(`#${id} has no open question`)
    if (!question.options.includes(option)) throw invalid(`Answer with one of: ${question.options.join(", ")}`)
    const row = await updateTask(tx, id, { question: null, ...(task.state === "claimed" ? { leaseExpiresAt: leaseFromNow() } : {}) })
    await taskReply(tx, row, actor, `${option}.`)
    emitTask(emit, "task.answered", row, actor, { option, question: question.text })
  })
  return getTask(db, id)
}
