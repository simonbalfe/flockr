import { jobLimits, type JobKind } from "@flockr/contracts"
import type { Database } from "../db/client"
import type { JobRow } from "../db/schema"
import { mutate } from "./events"
import { claimJobs, failJob, requeueStuckJobs } from "./jobs"
import { runRoutineJob, scheduleDueRoutines } from "./routines"

export type JobRunner = (db: Database, job: JobRow, now: Date) => Promise<void>

const runners = { routine: runRoutineJob } as const satisfies Record<JobKind, JobRunner>

export interface DrainResult {
  scheduled: number
  requeued: number
  ran: number
  retrying: number
  failed: number
}

export async function drainJobs(db: Database, options: { now?: Date; limit?: number } = {}): Promise<DrainResult> {
  const now = options.now ?? new Date()
  const scheduled = await scheduleDueRoutines(db, now)
  const requeued = await mutate(db, (tx, emit) => requeueStuckJobs(tx, emit, now))
  const claimed = await claimJobs(db, now, options.limit ?? jobLimits.batch)
  const result: DrainResult = { scheduled, requeued, ran: 0, retrying: 0, failed: 0 }
  for (const job of claimed) {
    try {
      await runners[job.kind](db, job, now)
      result.ran++
    } catch (error: unknown) {
      const state = await mutate(db, (tx, emit) => failJob(tx, emit, job, error, now))
      if (state === "failed") result.failed++
      else result.retrying++
    }
  }
  return result
}
