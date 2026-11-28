import { type AskBody, type Block, type CompleteBody, type Task } from "@flockr/contracts"
import { and, arrayContains, asc, eq, inArray } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { tasks, type TaskRow } from "../db/schema"
import { latestCommit, recordCommit } from "./commits"
import { forbidden, invalid } from "./errors"
import { leaseFromNow } from "./claims"
import { releaseTaskAreas } from "./areas"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { getTask } from "./read"
import { channelEvent, emitTask, feedCard, insertMessage, lockTask, requireHolder, requireState, taskReply, threadEvent, updateTask } from "./write"

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

interface Finish {
  type: "task.completed" | "task.approved"
  threadText: string
  channelText: string
  commit?: string
  reviewed?: string | null
  blocks?: Block[]
}

export async function finish(tx: Tx, emit: Emit, task: TaskRow, actor: string, how: Finish): Promise<void> {
  const { type, threadText, channelText, commit } = how
  if (commit) await recordCommit(tx, emit, task, actor, { sha: commit })
  const row = await updateTask(tx, task.id, { state: "done", leaseExpiresAt: null, question: null, reason: null })
  await releaseTaskAreas(tx, emit, row, actor)
  await insertMessage(tx, { channel: row.channel, kind: "event", who: actor, body: threadText, threadTaskId: row.id, blocks: how.blocks ?? [] })
  await channelEvent(tx, row.channel, actor, channelText)
  emitTask(emit, type, row, actor, { commit: commit ?? how.reviewed ?? (await latestCommit(tx, row.id)) })
  await startReadyTasks(tx, emit, row, actor)
}

export async function completeTask(db: Database, actor: string, id: number, body: CompleteBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    requireNoReviewer(task)
    if (body.note?.trim()) await taskReply(tx, task, actor, body.note.trim())
    await finish(tx, emit, task, actor, { type: "task.completed", threadText: "completed this task", channelText: `completed #${id}`, commit: body.commit })
  })
  return getTask(db, id)
}

export function requireNoReviewer(task: TaskRow): void {
  if (task.reviewer !== null) throw forbidden(`#${task.id} names ${task.reviewer} as reviewer; send it for review (flockr tasks submit ${task.id}) instead of marking it done`)
}

export async function failTask(db: Database, actor: string, id: number, reason: string, epoch: number | undefined): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, epoch)
    const row = await updateTask(tx, id, { state: "failed", holder: null, leaseExpiresAt: null, question: null, reason })
    await releaseTaskAreas(tx, emit, row, actor)
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
    await releaseTaskAreas(tx, emit, row, actor)
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

async function waitingOn(tx: Tx, id: number): Promise<number[]> {
  const rows = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.state, "waiting"), arrayContains(tasks.needs, [id]))).orderBy(asc(tasks.id))
  return rows.map((r) => r.id)
}

export async function cancelTask(db: Database, actor: string, id: number, reason: string): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "waiting", "ready", "claimed", "blocked", "review", "failed")
    const involved = task.holder === actor || task.assignee === actor
    if (member.kind !== "person" && !involved) throw forbidden(`${actor} neither holds nor is assigned #${id}; a person or its holder cancels it`)
    const row = await updateTask(tx, id, { state: "canceled", holder: null, leaseExpiresAt: null, question: null, reason })
    await releaseTaskAreas(tx, emit, row, actor)
    const stuck = await waitingOn(tx, id)
    await threadEvent(tx, row, actor, `canceled this task: ${reason}${stuck.length ? `. ${stuck.map((n) => `#${n}`).join(", ")} still ${stuck.length === 1 ? "needs" : "need"} it and stay waiting` : ""}`)
    await channelEvent(tx, row.channel, actor, `canceled #${id}: ${reason}`)
    emitTask(emit, "task.canceled", row, actor, { reason, holder: task.holder, waiting: stuck })
  })
  return getTask(db, id)
}

export async function reopenTask(db: Database, actor: string, id: number): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    if (member.kind !== "person") throw forbidden(`${actor} is not a person; only a person reopens a failed or canceled task`)
    const task = await lockTask(tx, id)
    requireState(task, "failed", "canceled")
    const needed = task.needs.length ? await tx.select({ state: tasks.state }).from(tasks).where(inArray(tasks.id, task.needs)) : []
    const state = needed.every((n) => n.state === "done") ? "ready" : "waiting"
    const row = await updateTask(tx, id, { state, reason: null, holder: null, leaseExpiresAt: null })
    await threadEvent(tx, row, actor, `reopened this task; it is ${state}`)
    emitTask(emit, "task.reopened", row, actor, { from: task.state, assignee: row.assignee })
  })
  return getTask(db, id)
}
