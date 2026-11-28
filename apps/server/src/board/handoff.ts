import { shortSha, taskBranch, type HandoffBody, type Task } from "@flockr/contracts"
import { and, desc, eq } from "drizzle-orm"
import { boardId } from "../config"
import type { Database, Executor } from "../db/client"
import { events } from "../db/schema"
import { moveTaskAreas } from "./areas"
import { recordCommit } from "./commits"
import { leaseFromNow } from "./claims"
import { invalid } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember, getTask } from "./read"
import { channelEvent, emitTask, lockTask, requireHolder, requireLiveLease, requireState, taskReply, threadEvent, updateTask } from "./write"
import { requireSeesTask } from "./tasks"

function handoffCard(id: number, body: HandoffBody): string {
  const lines = [`Hand-off to ${body.to}: ${body.note ?? "no summary"}`, `Branch: \`${taskBranch(id)}\``]
  if (body.lastCommit) lines.push(`Last commit: \`${shortSha(body.lastCommit)}\``)
  if (body.testState) lines.push(`Tests: ${body.testState}`)
  if (body.nextSteps.length) lines.push("Next:", ...body.nextSteps.map((step, i) => `${i + 1}. ${step}`))
  return lines.join("\n")
}

// A retry of a hand-off that already happened: the claim moved on, so the caller's epoch is one behind.
async function alreadyHandedOff(db: Executor, input: { id: number; from: string; to: string; epoch: number }): Promise<boolean> {
  const [last] = await db
    .select({ actor: events.actor, data: events.data })
    .from(events)
    .where(and(eq(events.boardId, boardId), eq(events.taskId, input.id), eq(events.type, "task.handed_off")))
    .orderBy(desc(events.seq))
    .limit(1)
  return last?.actor === input.from && last.data.to === input.to && last.data.fromEpoch === input.epoch
}

export async function handOffTask(db: Database, actor: string, id: number, body: HandoffBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, actor)
    if (!(await findMember(tx, body.to))) throw invalid(`Member ${body.to} does not exist`)
    const task = await lockTask(tx, id)
    await requireSeesTask(tx, body.to, task.channel)
    if (body.epoch !== undefined && body.epoch === task.claimEpoch - 1 && task.holder === body.to && (await alreadyHandedOff(tx, { id, from: actor, to: body.to, epoch: body.epoch }))) return
    requireState(task, "claimed")
    requireHolder(task, member, body.epoch)
    requireLiveLease(task)
    if (body.to === task.holder) throw invalid(`${body.to} already holds #${id}`)
    const row = await updateTask(tx, id, { holder: body.to, assignee: body.to, claimEpoch: task.claimEpoch + 1, leaseExpiresAt: leaseFromNow() })
    if (body.lastCommit) await recordCommit(tx, emit, row, actor, { sha: body.lastCommit })
    await taskReply(tx, row, actor, handoffCard(row.id, body))
    const areas = await moveTaskAreas(tx, emit, row, { actor, to: body.to })
    await threadEvent(tx, row, actor, `handed this task to ${body.to}${areas.length ? `, with its working area${areas.length > 1 ? "s" : ""}` : ""}`)
    await channelEvent(tx, row.channel, actor, `handed #${id} to ${body.to}`)
    emitTask(emit, "task.handed_off", row, actor, { from: task.holder, to: body.to, fromEpoch: task.claimEpoch, epoch: row.claimEpoch, branch: taskBranch(id), areas, note: body.note ?? null, lastCommit: body.lastCommit ?? null, testState: body.testState ?? null, nextSteps: body.nextSteps })
  })
  return getTask(db, id)
}
