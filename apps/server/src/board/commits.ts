import { shortSha, type AddCommitBody, type Task } from "@flockr/contracts"
import { desc, eq } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { taskCommits, type TaskRow } from "../db/schema"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { getTask } from "./read"
import { checkEpoch, emitTask, lockTask, threadEvent } from "./write"

export interface NewCommit {
  sha: string
  message?: string
}

export async function recordCommit(tx: Tx, emit: Emit, task: TaskRow, actor: string, commit: NewCommit): Promise<boolean> {
  const [row] = await tx
    .insert(taskCommits)
    .values({ taskId: task.id, sha: commit.sha, message: commit.message ?? null, addedBy: actor })
    .onConflictDoNothing({ target: [taskCommits.taskId, taskCommits.sha] })
    .returning()
  if (!row) return false
  await threadEvent(tx, task, actor, `added commit \`${shortSha(row.sha)}\`${row.message ? `: ${row.message}` : ""}`)
  emitTask(emit, "task.commit_added", task, actor, { sha: row.sha, message: row.message })
  return true
}

export async function latestCommit(tx: Tx, taskId: number): Promise<string | null> {
  const [row] = await tx.select({ sha: taskCommits.sha }).from(taskCommits).where(eq(taskCommits.taskId, taskId)).orderBy(desc(taskCommits.id)).limit(1)
  return row?.sha ?? null
}

export async function addTaskCommit(db: Database, actor: string, id: number, body: AddCommitBody): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const task = await lockTask(tx, id)
    checkEpoch(task, body.epoch)
    await recordCommit(tx, emit, task, actor, body)
  })
  return getTask(db, id)
}
