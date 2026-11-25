import { eq } from "drizzle-orm"
import type { Tx } from "../db/client"
import { messages, tasks, type MemberRow, type MessageRow, type TaskRow } from "../db/schema"
import { leaseExpired, notFound, notHolder, staleClaim, wrongState } from "./errors"
import type { Emit } from "./events"
import { messageKey } from "./read"

type NewMessage = typeof messages.$inferInsert

export async function insertMessage(tx: Tx, values: NewMessage): Promise<MessageRow> {
  const [row] = await tx.insert(messages).values(values).returning()
  if (!row) throw new Error("Message insert returned nothing")
  return row
}

export function channelEvent(tx: Tx, channel: string, who: string, text: string, system = false): Promise<MessageRow> {
  return insertMessage(tx, { channel, kind: "event", who, body: text, system })
}

export function threadEvent(tx: Tx, task: TaskRow, who: string, text: string): Promise<MessageRow> {
  return insertMessage(tx, { channel: task.channel, kind: "event", who, body: text, threadTaskId: task.id })
}

export function taskReply(tx: Tx, task: TaskRow, who: string, text: string): Promise<MessageRow> {
  return insertMessage(tx, { channel: task.channel, kind: "text", who, body: text, threadTaskId: task.id })
}

export function messageReply(tx: Tx, parent: MessageRow, who: string, text: string): Promise<MessageRow> {
  return insertMessage(tx, { channel: parent.channel, kind: "text", who, body: text, parentId: parent.id })
}

export function feedText(tx: Tx, channel: string, who: string, text: string, taskId: number | null = null): Promise<MessageRow> {
  return insertMessage(tx, { channel, kind: "text", who, body: text, taskId })
}

export function feedCard(tx: Tx, task: TaskRow, who: string, kind: "task" | "ask"): Promise<MessageRow> {
  return insertMessage(tx, { channel: task.channel, kind, who, taskId: task.id })
}

export async function lockTask(tx: Tx, id: number): Promise<TaskRow> {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update")
  if (!row) throw notFound(`Task #${id} does not exist`)
  return row
}

export async function updateTask(tx: Tx, id: number, values: Partial<typeof tasks.$inferInsert>): Promise<TaskRow> {
  const [row] = await tx
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning()
  if (!row) throw notFound(`Task #${id} does not exist`)
  return row
}

export function requireState(task: TaskRow, ...allowed: TaskRow["state"][]): void {
  if (!allowed.includes(task.state)) throw wrongState(`#${task.id} is ${task.state}, expected ${allowed.join(" or ")}`)
}

export function checkEpoch(task: TaskRow, epoch: number | undefined): void {
  if (epoch !== undefined && epoch !== task.claimEpoch) {
    throw staleClaim(`Stale claim on #${task.id}: you sent epoch ${epoch}, the current claim is epoch ${task.claimEpoch}. Read the task and claim again.`)
  }
}

export function requireHolder(task: TaskRow, actor: MemberRow, epoch: number | undefined): void {
  checkEpoch(task, epoch)
  if (actor.kind === "agent" && task.holder !== actor.name) {
    throw notHolder(`${actor.name} does not hold #${task.id}${task.holder ? `; ${task.holder} does` : ""}`)
  }
}

export function requireLiveLease(task: TaskRow, now = new Date()): void {
  if (task.leaseExpiresAt && task.leaseExpiresAt < now && !task.question) {
    throw leaseExpired(`Your lease on #${task.id} ran out; it is no longer yours. Read the task and claim it again.`)
  }
}

export function requireClaimable(task: TaskRow, actor: MemberRow): void {
  if (actor.kind === "agent" && task.assignee !== null && task.assignee !== actor.name) {
    throw notHolder(`#${task.id} is assigned to ${task.assignee}; only ${task.assignee} can claim it`)
  }
}

export function emitTask(emit: Emit, type: string, task: TaskRow, actor: string, data: Record<string, unknown> = {}): void {
  emit({ type, actor, channel: task.channel, taskId: task.id, threadId: String(task.id), data: { state: task.state, ...data } })
}

export function emitMessage(emit: Emit, type: string, row: MessageRow, actor: string, threadId: string | null, data: Record<string, unknown> = {}): void {
  emit({ type, actor, channel: row.channel, taskId: row.threadTaskId ?? row.taskId, threadId, messageId: messageKey(row.id), data })
}
