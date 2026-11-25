import {
  actionKindRules,
  actionKinds,
  allowedVerdicts,
  approvalEventTypes,
  approvalOptions,
  effectiveVerdict,
  mayManageApprovalRules,
  routineActor,
  verdictAllowed,
  type ActionKind,
  type ApprovalCheck,
  type ApprovalRule,
  type ApprovalRules,
  type ApprovalScopeQuery,
  type ApprovalSource,
  type ApprovalVerdict,
  type ClearedApprovalRule,
  type SetApprovalRuleBody,
} from "@flockr/contracts"
import { and, eq, isNull, or } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { approvalRules, jobApprovals, type ApprovalRuleRow, type JobRow } from "../db/schema"
import { forbidden, invalid } from "./errors"
import { mutate, type Emit } from "./events"
import { approveWaitingJob, finishJob, lockWaitingJob } from "./jobs"
import { requireActor } from "./members"
import { messageKey, requireChannel } from "./read"
import { emitMessage, insertMessage } from "./write"

function present(row: ApprovalRuleRow): ApprovalRule {
  return { kind: row.kind, channel: row.channel, verdict: row.verdict, setBy: row.setBy, updatedAt: row.updatedAt.toISOString() }
}

const scopeOf = (channel: string | null) => (channel === null ? isNull(approvalRules.channel) : eq(approvalRules.channel, channel))

const kindOrder = (kind: ActionKind) => actionKinds.indexOf(kind)

export async function listApprovalRules(db: Executor): Promise<ApprovalRules> {
  const rows = await db.select().from(approvalRules)
  const sorted = rows.toSorted((a, b) => (a.channel ?? "").localeCompare(b.channel ?? "") || kindOrder(a.kind) - kindOrder(b.kind))
  return { kinds: actionKinds.map((kind) => ({ kind, ...actionKindRules[kind] })), rules: sorted.map(present) }
}

export async function checkApproval(db: Executor, kind: ActionKind, channel: string | null): Promise<ApprovalCheck> {
  if (channel !== null) await requireChannel(db, channel)
  const rows = await db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.kind, kind), channel === null ? isNull(approvalRules.channel) : or(isNull(approvalRules.channel), eq(approvalRules.channel, channel))))
  const channelRow = rows.find((r) => r.channel !== null)
  const boardRow = rows.find((r) => r.channel === null)
  const { verdict, source } = effectiveVerdict(kind, { channel: channelRow?.verdict ?? null, board: boardRow?.verdict ?? null })
  const applied = { channel: channelRow, board: boardRow, default: undefined } satisfies Record<ApprovalSource, ApprovalRuleRow | undefined>
  const rule = applied[source]
  return { kind, channel, verdict, source, floor: actionKindRules[kind].floor, rule: rule ? present(rule) : null }
}

export const verdictFor = async (db: Executor, kind: ActionKind, channel: string): Promise<ApprovalVerdict> => (await checkApproval(db, kind, channel)).verdict

async function requireManager(tx: Tx, actor: string): Promise<void> {
  const row = await requireActor(tx, actor)
  if (!mayManageApprovalRules(row)) throw forbidden(`${actor} is an ${row.kind}; only a person can set or clear an approval rule`)
}

export async function setApprovalRule(db: Database, actor: string, body: SetApprovalRuleBody, now = new Date()): Promise<ApprovalRule> {
  return mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    if (body.channel !== null) await requireChannel(tx, body.channel)
    const info = actionKindRules[body.kind]
    if (!verdictAllowed(body.kind, body.verdict)) {
      throw invalid(`${info.label} is never looser than ${info.floor}: no rule can set it to ${body.verdict}. Set ${allowedVerdicts(body.kind).join(" or ")}`)
    }
    const [current] = await tx
      .select()
      .from(approvalRules)
      .where(and(eq(approvalRules.kind, body.kind), scopeOf(body.channel)))
      .for("update")
    if (current && current.verdict === body.verdict) return present(current)
    const [row] = await tx
      .insert(approvalRules)
      .values({ kind: body.kind, channel: body.channel, verdict: body.verdict, setBy: actor, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [approvalRules.kind, approvalRules.channel], set: { verdict: body.verdict, setBy: actor, updatedAt: now } })
      .returning()
    if (!row) throw new Error("Approval rule upsert returned nothing")
    emit({ type: approvalEventTypes.set, actor, channel: body.channel, data: { kind: body.kind, channel: body.channel, verdict: body.verdict, was: current?.verdict ?? null } })
    return present(row)
  })
}

export async function clearApprovalRule(db: Database, actor: string, query: ApprovalScopeQuery): Promise<ClearedApprovalRule> {
  const channel = query.channel ?? null
  return mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    if (channel !== null) await requireChannel(tx, channel)
    const deleted = await tx
      .delete(approvalRules)
      .where(and(eq(approvalRules.kind, query.kind), scopeOf(channel)))
      .returning()
    const [row] = deleted
    if (row) emit({ type: approvalEventTypes.cleared, actor, channel, data: { kind: query.kind, channel, was: row.verdict } })
    return { kind: query.kind, channel, cleared: row !== undefined }
  })
}

export async function allowedOnce(tx: Tx, jobId: number): Promise<boolean> {
  const [row] = await tx
    .select({ jobId: jobApprovals.jobId })
    .from(jobApprovals)
    .where(and(eq(jobApprovals.jobId, jobId), eq(jobApprovals.answer, approvalOptions.allow)))
  return row !== undefined
}

export interface ApprovalRequest {
  job: JobRow
  kind: ActionKind
  channel: string
  text: string
  detail: string
}

export async function askApproval(tx: Tx, emit: Emit, request: ApprovalRequest): Promise<string> {
  const { channel, text } = request
  const root = await insertMessage(tx, { channel, kind: "text", who: routineActor, body: `${text}. Allow it once or deny it in this thread.` })
  const threadId = messageKey(root.id)
  emitMessage(emit, "message.posted", root, routineActor, threadId, { mentions: [] })
  const question = { text: `${text}?`, detail: request.detail, options: [approvalOptions.allow, approvalOptions.deny] }
  const asked = await insertMessage(tx, { channel, kind: "question", who: routineActor, body: question.text, question, parentId: root.id })
  const questionId = messageKey(asked.id)
  emit({ type: "question.asked", actor: routineActor, channel, taskId: null, threadId, messageId: questionId, data: { question, job: request.job.id, kind: request.kind } })
  await tx.insert(jobApprovals).values({ jobId: request.job.id, kind: request.kind, channel, questionId: asked.id })
  return `Asked in ${threadId}`
}

export interface ApprovalAnswer {
  questionId: number
  option: string
  by: string
  now: Date
}

export async function settleJobApproval(tx: Tx, emit: Emit, answer: ApprovalAnswer): Promise<void> {
  const [approval] = await tx.select().from(jobApprovals).where(eq(jobApprovals.questionId, answer.questionId)).for("update")
  if (!approval || approval.answer !== null) return
  await tx.update(jobApprovals).set({ answer: answer.option, answeredBy: answer.by, answeredAt: answer.now }).where(eq(jobApprovals.jobId, approval.jobId))
  const job = await lockWaitingJob(tx, approval.jobId)
  if (!job) return
  if (answer.option === approvalOptions.allow) await approveWaitingJob(tx, emit, job, answer.by, answer.now)
  else await finishJob(tx, emit, job, { state: "skipped", result: `Denied by ${answer.by}` }, answer.now)
}
