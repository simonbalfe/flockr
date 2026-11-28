import { reviewLimits, reviewRefusal, shortSha, type ReviewAct, type ApproveBody, type SetReviewerBody, type SubmitBody, type Task } from "@flockr/contracts"
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { channels, events, tasks, type MemberRow, type TaskRow } from "../db/schema"
import { BoardError, forbidden, invalid } from "./errors"
import { latestCommit, recordCommit } from "./commits"
import { leaseFromNow } from "./claims"
import { releaseTaskAreas } from "./areas"
import { mutate } from "./events"
import { finish } from "./flow"
import { requireActor } from "./members"
import { findMember, getTask } from "./read"
import { requireSeesTask } from "./tasks"
import { emitTask, feedText, lockTask, requireHolder, requireState, taskReply, threadEvent, updateTask } from "./write"

const staleReview = (message: string) => new BoardError("stale_review", message)
const reviewFull = (message: string) => new BoardError("review_full", message)

export const sameCommit = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a)

async function reviewNeedsPerson(tx: Tx, channel: string): Promise<boolean> {
  const [row] = await tx.select({ needs: channels.reviewNeedsPerson }).from(channels).where(eq(channels.id, channel))
  return row?.needs ?? false
}

async function openReviews(tx: Tx, where: SQL, except: number): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.state, "review"), where, ne(tasks.id, except)))
  return row?.count ?? 0
}

export async function requireReviewer(tx: Tx, task: TaskRow, actor: MemberRow, act: ReviewAct): Promise<void> {
  const reason = reviewRefusal({ actor, task, act, reviewNeedsPerson: act === "approve" && actor.kind !== "person" && (await reviewNeedsPerson(tx, task.channel)) })
  if (reason) throw forbidden(reason)
}

async function requireCandidate(tx: Tx, task: TaskRow, name: string): Promise<MemberRow> {
  const member = await findMember(tx, name)
  if (!member) throw invalid(`Member ${name} does not exist`)
  if (task.holder === name) throw invalid(`${name} holds #${task.id}; name someone else to review it`)
  await requireSeesTask(tx, name, task.channel)
  return member
}

async function requireReviewerRoom(tx: Tx, task: TaskRow, reviewer: MemberRow): Promise<void> {
  if (reviewer.kind === "person") return
  const open = await openReviews(tx, eq(tasks.reviewer, reviewer.name), task.id)
  if (open >= reviewLimits.openPerReviewer) throw reviewFull(`${reviewer.name} already has ${open} reviews open; name someone else or leave it to a person`)
}

async function requireHolderRoom(tx: Tx, task: TaskRow, holder: MemberRow): Promise<void> {
  if (holder.kind === "person") return
  const open = await openReviews(tx, eq(tasks.holder, holder.name), task.id)
  if (open >= reviewLimits.inReviewPerHolder) throw reviewFull(`${holder.name} has ${open} tasks waiting for review; get one reviewed first`)
}

export async function submitForReview(db: Database, actor: string, id: number, body: SubmitBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    const reviewer = body.reviewer ?? task.reviewer
    const named = reviewer === null ? null : await requireCandidate(tx, task, reviewer)
    if (named) await requireReviewerRoom(tx, task, named)
    await requireHolderRoom(tx, task, member)
    if (body.commit) await recordCommit(tx, emit, task, actor, { sha: body.commit })
    const commit = body.commit ?? (await latestCommit(tx, id))
    const note = body.note?.trim() || (commit ? `Done in \`${shortSha(commit)}\`. Ready for review.` : "Done. Ready for review.")
    await taskReply(tx, task, actor, note)
    const row = await updateTask(tx, id, { state: "review", leaseExpiresAt: null, question: null, reviewer, reviewCommit: commit })
    await releaseTaskAreas(tx, emit, row, actor)
    await feedText(tx, row.channel, actor, `Finished #${id}, ready for review${reviewer ? ` by ${reviewer}` : ""}.`, id)
    emitTask(emit, "task.submitted", row, actor, { commit, reviewer })
  })
  return getTask(db, id)
}

export async function setTaskReviewer(db: Database, actor: string, id: number, body: SetReviewerBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    if (task.state === "done") throw invalid(`#${id} is done; its review is over`)
    if (task.reviewer === body.reviewer) return
    const mayChange = member.kind === "person" || task.holder === actor || (task.holder === null && task.assignee === actor)
    if (!mayChange) throw forbidden(`Only a person or the holder of #${id} names its reviewer`)
    const named = body.reviewer === null ? null : await requireCandidate(tx, task, body.reviewer)
    if (named && task.state === "review") await requireReviewerRoom(tx, task, named)
    const row = await updateTask(tx, id, { reviewer: body.reviewer })
    await threadEvent(tx, row, actor, body.reviewer ? `asked ${body.reviewer} to review this task` : "cleared the reviewer; a person reviews this task")
    emitTask(emit, "task.reviewer_set", row, actor, { reviewer: body.reviewer, previous: task.reviewer })
  })
  return getTask(db, id)
}

async function lastApproval(tx: Tx, id: number): Promise<{ actor: string; commit: unknown } | null> {
  const [row] = await tx
    .select({ actor: events.actor, data: events.data })
    .from(events)
    .where(and(eq(events.taskId, id), eq(events.type, "task.approved")))
    .orderBy(desc(events.seq))
    .limit(1)
  return row ? { actor: row.actor, commit: row.data.commit } : null
}

async function alreadyApproved(tx: Tx, task: TaskRow, actor: string, commit: string | undefined): Promise<boolean> {
  if (task.state !== "done") return false
  const last = await lastApproval(tx, task.id)
  if (!last || last.actor !== actor) return false
  return commit === undefined || (typeof last.commit === "string" && sameCommit(last.commit, commit))
}

function requireFresh(task: TaskRow, commit: string | undefined): void {
  if (commit === undefined) return
  if (task.reviewCommit === null) throw staleReview(`#${task.id} has no commit under review; read the thread and approve without one`)
  if (!sameCommit(task.reviewCommit, commit)) throw staleReview(`#${task.id} moved to \`${shortSha(task.reviewCommit)}\` since you looked; read it and approve again`)
}

export async function approveTask(db: Database, actor: string, id: number, body: ApproveBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    if (await alreadyApproved(tx, task, actor, body.commit)) return
    requireState(task, "review")
    await requireReviewer(tx, task, member, "approve")
    requireFresh(task, body.commit)
    await finish(tx, emit, task, actor, { type: "task.approved", threadText: "approved and completed this task", channelText: `approved #${id}`, reviewed: task.reviewCommit })
  })
  return getTask(db, id)
}

export async function requestChanges(db: Database, actor: string, id: number, note: string | undefined): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    requireState(task, "review")
    await requireReviewer(tx, task, member, "changes")
    const row = await updateTask(tx, id, { state: "claimed", leaseExpiresAt: leaseFromNow(), reviewCommit: null })
    await taskReply(tx, row, actor, note?.trim() || "A couple of changes, see the thread.")
    emitTask(emit, "task.changes_requested", row, actor, { holder: row.holder })
  })
  return getTask(db, id)
}

