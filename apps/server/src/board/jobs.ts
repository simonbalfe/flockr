import { backoffSeconds, jobEventTypes, jobLimits, routineActor, type JobKind } from "@flockr/contracts"
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { jobs, type JobRow } from "../db/schema"
import type { Emit } from "./events"

export interface JobDraft {
  kind: JobKind
  key: string
  routineId: number | null
  payload: Record<string, unknown>
  runAt?: Date
}

const emitJob = (emit: Emit, type: string, job: JobRow, data: Record<string, unknown>) =>
  emit({ type, actor: routineActor, data: { job: job.id, kind: job.kind, routine: job.routineId, ...data } })

export async function enqueueJob(tx: Executor, draft: JobDraft): Promise<boolean> {
  const rows = await tx
    .insert(jobs)
    .values({ ...draft, runAt: draft.runAt ?? new Date(), maxAttempts: jobLimits.maxAttempts })
    .onConflictDoNothing({ target: jobs.key })
    .returning({ id: jobs.id })
  return rows.length > 0
}

export async function claimJobs(db: Database, now: Date, limit: number = jobLimits.batch): Promise<JobRow[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.state, "queued"), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(limit)
      .for("update", { skipLocked: true })
    if (!due.length) return []
    return tx
      .update(jobs)
      .set({ state: "running", attempts: sql`${jobs.attempts} + 1`, startedAt: now, lockedUntil: new Date(now.getTime() + jobLimits.lockSeconds * 1000) })
      .where(
        inArray(
          jobs.id,
          due.map((d) => d.id),
        ),
      )
      .returning()
  })
}

export async function requeueStuckJobs(tx: Tx, emit: Emit, now: Date): Promise<number> {
  const stuck = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.state, "running"), lt(jobs.lockedUntil, now)))
    .for("update", { skipLocked: true })
  for (const job of stuck) {
    const spent = job.attempts >= job.maxAttempts
    const lastError = "Its drainer stopped before it finished"
    await tx
      .update(jobs)
      .set({ state: spent ? "failed" : "queued", lockedUntil: null, runAt: now, lastError, finishedAt: spent ? now : null })
      .where(eq(jobs.id, job.id))
    emitJob(emit, spent ? jobEventTypes.failed : jobEventTypes.retrying, job, { attempts: job.attempts, error: lastError })
  }
  return stuck.length
}

export async function lockClaimedJob(tx: Tx, job: JobRow): Promise<boolean> {
  const [row] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update")
  return row !== undefined && row.state === "running" && row.attempts === job.attempts
}

export type JobOutcome = { state: "done"; result: string } | { state: "skipped"; result: string } | { state: "waiting"; result: string }

const outcomeMeaning = {
  done: { event: jobEventTypes.finished, ends: true },
  skipped: { event: jobEventTypes.finished, ends: true },
  waiting: { event: jobEventTypes.waiting, ends: false },
} as const satisfies Record<JobOutcome["state"], { event: string; ends: boolean }>

export async function finishJob(tx: Tx, emit: Emit, job: JobRow, outcome: JobOutcome, now: Date): Promise<void> {
  const meaning = outcomeMeaning[outcome.state]
  await tx
    .update(jobs)
    .set({ state: outcome.state, result: outcome.result, lastError: null, lockedUntil: null, finishedAt: meaning.ends ? now : null })
    .where(eq(jobs.id, job.id))
  emitJob(emit, meaning.event, job, { state: outcome.state, result: outcome.result })
}

export async function lockWaitingJob(tx: Tx, id: number): Promise<JobRow | null> {
  const [row] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update")
  return row !== undefined && row.state === "waiting" ? row : null
}

export async function approveWaitingJob(tx: Tx, emit: Emit, job: JobRow, by: string, now: Date): Promise<void> {
  const result = `Allowed once by ${by}`
  await tx.update(jobs).set({ state: "queued", runAt: now, result }).where(eq(jobs.id, job.id))
  emitJob(emit, jobEventTypes.approved, job, { by, result })
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, jobLimits.errorMax)

export async function failJob(tx: Tx, emit: Emit, job: JobRow, error: unknown, now: Date): Promise<JobRow["state"]> {
  if (!(await lockClaimedJob(tx, job))) return job.state
  const message = errorText(error)
  const spent = job.attempts >= job.maxAttempts
  const state = spent ? "failed" : "queued"
  await tx
    .update(jobs)
    .set({
      state,
      lastError: message,
      lockedUntil: null,
      runAt: spent ? job.runAt : new Date(now.getTime() + backoffSeconds(job.attempts) * 1000),
      finishedAt: spent ? now : null,
    })
    .where(eq(jobs.id, job.id))
  emitJob(emit, spent ? jobEventTypes.failed : jobEventTypes.retrying, job, { attempts: job.attempts, error: message })
  return state
}
