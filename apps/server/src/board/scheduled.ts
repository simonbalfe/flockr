import { jobLimits, scheduleLimits, ScheduledPayload, type JobState, type SchedulePostBody, type ScheduledPost, type ScheduledState } from "@flockr/contracts"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import type { Database, Executor } from "../db/client"
import { jobs, type JobRow } from "../db/schema"
import { forbidden, invalid, notFound, wrongState } from "./errors"
import { mutate } from "./events"
import { finishJob, lockClaimedJob } from "./jobs"
import { requireActor } from "./members"
import { postIn } from "./messages"
import { findMember, messageKey, requireChannel } from "./read"
import { canSee, viewerOf } from "./visibility"

const shownAs = {
  queued: "scheduled",
  running: "scheduled",
  waiting: "scheduled",
  done: "posted",
  skipped: "canceled",
  failed: "failed",
} as const satisfies Record<JobState, ScheduledState>

const jobId = (id: number) => `j${id}`

function present(row: JobRow): ScheduledPost {
  const payload = ScheduledPayload.parse(row.payload)
  return {
    id: jobId(row.id),
    channel: payload.channel,
    text: payload.text,
    by: payload.by,
    at: row.runAt.toISOString(),
    state: shownAs[row.state],
    messageId: row.state === "done" && row.result?.startsWith("m") ? row.result : null,
  }
}

export async function schedulePost(db: Database, actor: string, channel: string, body: SchedulePostBody, now = new Date()): Promise<ScheduledPost> {
  const at = new Date(body.at)
  if (at <= now) throw invalid("Schedule it in the future; to post now, post it")
  if (at.getTime() - now.getTime() > scheduleLimits.maxDays * 86_400_000) throw invalid(`Schedule it at most ${scheduleLimits.maxDays} days ahead`)
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, channel)
    const key = `post:${actor}:${body.key ?? crypto.randomUUID()}`
    const payload = { channel, text: body.text, by: actor }
    const [row] = await tx.insert(jobs).values({ kind: "post", key, routineId: null, payload, runAt: at, maxAttempts: jobLimits.maxAttempts }).onConflictDoNothing({ target: jobs.key }).returning()
    if (!row) {
      const [prior] = await tx.select().from(jobs).where(eq(jobs.key, key))
      if (!prior) throw new Error("Scheduled post vanished")
      const same = ScheduledPayload.parse(prior.payload)
      if (same.text !== body.text || same.channel !== channel || prior.runAt.getTime() !== at.getTime()) throw invalid(`Key ${body.key} was already used for another scheduled post; use a new key`)
      return present(prior)
    }
    emit({ type: "post.scheduled", actor, channel, data: { scheduled: jobId(row.id), at: at.toISOString() } })
    return present(row)
  })
}

export async function listScheduledPosts(db: Executor, actor: string): Promise<ScheduledPost[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.kind, "post"), sql`${jobs.payload}->>'by' = ${actor}`, inArray(jobs.state, ["queued", "running", "waiting"])))
    .orderBy(asc(jobs.runAt), asc(jobs.id))
  return rows.map(present)
}

export async function cancelScheduledPost(db: Database, actor: string, channel: string, id: string): Promise<ScheduledPost> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const [row] = await tx.select().from(jobs).where(eq(jobs.id, Number(id.slice(1)))).for("update")
    const payload = row?.kind === "post" ? ScheduledPayload.parse(row.payload) : null
    if (!row || !payload || payload.channel !== channel) throw notFound(`No scheduled post ${id} in #${channel}`)
    if (payload.by !== actor) throw forbidden(`${id} is ${payload.by}'s scheduled post; only they cancel it`)
    if (row.state === "skipped") return present(row)
    if (row.state !== "queued") throw wrongState(`${id} is ${shownAs[row.state]}; only a post still waiting for its time can be canceled`)
    const now = new Date()
    const [canceled] = await tx.update(jobs).set({ state: "skipped", result: `Canceled by ${actor}`, finishedAt: now }).where(eq(jobs.id, row.id)).returning()
    if (!canceled) throw new Error("Scheduled post update returned nothing")
    emit({ type: "post.schedule_canceled", actor, channel, data: { scheduled: id } })
    return present(canceled)
  })
}

export async function runPostJob(db: Database, job: JobRow, now: Date): Promise<void> {
  const payload = ScheduledPayload.parse(job.payload)
  await mutate(db, async (tx, emit) => {
    if (!(await lockClaimedJob(tx, job))) return
    const author = await findMember(tx, payload.by)
    if (!author || !(await canSee(tx, viewerOf(payload.by), payload.channel))) {
      await finishJob(tx, emit, job, { state: "skipped", result: `${payload.by} can no longer post in #${payload.channel}` }, now)
      return
    }
    const created = await postIn(tx, emit, { actor: payload.by, channel: payload.channel, said: { text: payload.text, labels: [] } })
    await finishJob(tx, emit, job, { state: "done", result: messageKey(created.id) }, now)
  })
}
