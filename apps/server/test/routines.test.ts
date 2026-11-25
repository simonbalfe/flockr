import { describe, expect, test } from "bun:test"
import { backoffSeconds, Brief, ErrorBody, jobLimits, Job, Routine, routineActor, routineLimits } from "@flockr/contracts"
import { and, desc, eq, like, sql } from "drizzle-orm"
import { z } from "zod"
import { drainJobs } from "../src/board/drain"
import { claimJobs, enqueueJob } from "../src/board/jobs"
import type { Database } from "../src/db/client"
import { jobs, members, messages, routines } from "../src/db/schema"
import { freshBoard } from "./harness"

type Board = Awaited<ReturnType<typeof freshBoard>>

const watcher = (overrides: Record<string, unknown> = {}) => ({
  name: "Echo backend",
  channel: "backend",
  trigger: { kind: "event", eventType: "message.posted" },
  action: { kind: "post", text: "Seen it" },
  ...overrides,
})

async function created(board: Board, body: Record<string, unknown>, on = true): Promise<Routine> {
  const made = await board.call("simon", "POST", "/api/routines", body)
  expect(made.status).toBe(200)
  const routine = Routine.parse(made.json)
  if (!on) return routine
  const enabled = await board.call("simon", "POST", `/api/routines/${routine.id}/on`)
  expect(enabled.status).toBe(200)
  return Routine.parse(enabled.json)
}

const post = async (board: Board, channel: string, text: string) => {
  const posted = await board.call("simon", "POST", `/api/channels/${channel}/messages`, { text })
  expect(posted.status).toBe(200)
}

const jobsOf = async (board: Board, id: number) => z.array(Job).parse((await board.call("simon", "GET", `/api/routines/${id}/jobs?limit=50`)).json)

const postsBy = (db: Database, who: string) => db.select().from(messages).where(and(eq(messages.who, who), eq(messages.kind, "text")))

describe("managing routines", () => {
  test("a new routine is off, and only a person can create, turn on, change or delete one", async () => {
    const board = await freshBoard()
    const routine = await created(board, watcher(), false)
    expect(routine).toMatchObject({ enabled: false, perHour: routineLimits.perHourDefault, createdBy: "simon", nextRunAt: null, recentJobs: [] })
    for (const [method, path, body] of [
      ["POST", "/api/routines", watcher()],
      ["POST", `/api/routines/${routine.id}/on`, undefined],
      ["PATCH", `/api/routines/${routine.id}`, { perHour: 1 }],
      ["DELETE", `/api/routines/${routine.id}`, undefined],
    ] as const) {
      const refused = await board.call("claude", method, path, body)
      expect(refused.status).toBe(403)
      expect(ErrorBody.parse(refused.json).kind).toBe("forbidden")
    }
    const deleted = await board.call("simon", "DELETE", `/api/routines/${routine.id}`)
    expect(deleted.status).toBe(200)
    expect((await board.call("simon", "DELETE", `/api/routines/${routine.id}`)).status).toBe(200)
    const listed = z.array(Routine).parse((await board.call("tim", "GET", "/api/routines")).json)
    expect(listed.map((r) => r.name)).toEqual(["Morning brief"])
  })

  test("a bad schedule or an unknown agent is refused", async () => {
    const board = await freshBoard()
    const badCron = await board.call("simon", "POST", "/api/routines", watcher({ trigger: { kind: "cron", schedule: "0 25 * * *" } }))
    expect(badCron.status).toBe(400)
    expect(ErrorBody.parse(badCron.json).error).toContain("hour")
    const badAgent = await board.call("simon", "POST", "/api/routines", watcher({ action: { kind: "mention", agent: "nobody", text: "hi" } }))
    expect(badAgent.status).toBe(400)
  })
})

describe("the jobs queue", () => {
  test("a job is claimed by exactly one drainer at once", async () => {
    const { db } = await freshBoard()
    await enqueueJob(db, { kind: "routine", key: "one", routineId: null, payload: { cause: { kind: "event", seq: 1, type: "message.posted" } } })
    const now = new Date()
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimJobs(db, now)))
    expect(claims.flat().length).toBe(1)
    expect(claims.flat()[0]).toMatchObject({ state: "running", attempts: 1 })
  })

  test("two drainers at once run a watcher's job once", async () => {
    const board = await freshBoard()
    await created(board, watcher())
    await post(board, "backend", "hello")
    const results = await Promise.all([drainJobs(board.db), drainJobs(board.db), drainJobs(board.db)])
    expect(results.reduce((n, r) => n + r.ran, 0)).toBe(1)
    expect((await postsBy(board.db, routineActor)).map((m) => m.body)).toEqual(["Seen it"])
  })

  test("a failing job backs off, then fails at its limit with its last error kept", async () => {
    const board = await freshBoard()
    const routine = await created(board, watcher({ action: { kind: "mention", agent: "gemini", text: "look" } }))
    await board.db.update(members).set({ removedAt: new Date() }).where(eq(members.name, "gemini"))
    await post(board, "backend", "anyone?")
    let now = new Date()
    for (let attempt = 1; attempt <= jobLimits.maxAttempts; attempt++) {
      const drained = await drainJobs(board.db, { now })
      expect(drained.ran).toBe(0)
      const [job] = await jobsOf(board, routine.id)
      expect(job).toMatchObject({ attempts: attempt, lastError: "gemini is no longer an agent on this board" })
      if (attempt === jobLimits.maxAttempts) {
        expect(job?.state).toBe("failed")
        break
      }
      expect(job?.state).toBe("queued")
      const wait = backoffSeconds(attempt) * 1000
      expect(new Date(job?.runAt ?? 0).getTime()).toBe(now.getTime() + wait)
      await drainJobs(board.db, { now: new Date(now.getTime() + wait - 1000) })
      expect((await jobsOf(board, routine.id))[0]?.attempts).toBe(attempt)
      now = new Date(now.getTime() + wait)
    }
    expect((await drainJobs(board.db, { now: new Date(now.getTime() + 86_400_000) })).failed).toBe(0)
    expect(await postsBy(board.db, routineActor)).toEqual([])
  })

  test("a job whose drainer died goes back to the queue after its lock runs out", async () => {
    const board = await freshBoard()
    const routine = await created(board, watcher())
    await post(board, "backend", "hello")
    const now = new Date()
    expect((await claimJobs(board.db, now)).length).toBe(1)
    expect((await drainJobs(board.db, { now })).ran).toBe(0)
    const later = new Date(now.getTime() + jobLimits.lockSeconds * 1000 + 1000)
    expect(await drainJobs(board.db, { now: later })).toMatchObject({ requeued: 1, ran: 1 })
    expect((await jobsOf(board, routine.id))[0]).toMatchObject({ state: "done", attempts: 2 })
  })
})

describe("watchers", () => {
  test("an event routine enqueues exactly one job per matching event, in the event's transaction, and never fires on its own posts", async () => {
    const board = await freshBoard()
    const routine = await created(board, watcher())
    await post(board, "backend", "one")
    await post(board, "backend", "two")
    await post(board, "platform", "elsewhere")
    const thread = await board.call("simon", "POST", "/api/threads/806/replies", { text: "a reply is not a post" })
    expect(thread.status).toBe(200)
    const queued = await board.db.select().from(jobs).where(eq(jobs.routineId, routine.id))
    expect(queued.length).toBe(2)
    const same = await board.db.execute<{ same: boolean }>(
      sql`select bool_and(j.xmin = e.xmin) as same from jobs j join events e on e.seq = (j.payload->'cause'->>'seq')::bigint where j.routine_id = ${routine.id}`,
    )
    expect(same[0]?.same).toBe(true)
    const posted = await board.db.execute<{ type: string }>(sql`select e.type from jobs j join events e on e.seq = (j.payload->'cause'->>'seq')::bigint`)
    expect(posted.map((r) => r.type)).toEqual(["message.posted", "message.posted"])
    expect((await drainJobs(board.db)).ran).toBe(2)
    expect((await drainJobs(board.db)).ran).toBe(0)
    expect((await postsBy(board.db, routineActor)).length).toBe(2)
    expect((await board.db.select().from(jobs)).length).toBe(2)
  })

  test("a routine that is off never runs, even with a run already queued", async () => {
    const board = await freshBoard()
    const routine = await created(board, watcher(), false)
    await post(board, "backend", "while off")
    expect((await board.db.select().from(jobs)).length).toBe(0)
    await board.call("simon", "POST", `/api/routines/${routine.id}/on`)
    await post(board, "backend", "while on")
    await board.call("simon", "POST", `/api/routines/${routine.id}/off`)
    await drainJobs(board.db)
    expect((await jobsOf(board, routine.id)).map((j) => [j.state, j.result])).toEqual([["skipped", "The routine is off"]])
    const seeded = z.array(Routine).parse((await board.call("simon", "GET", "/api/routines")).json).find((r) => r.name === "Morning brief")
    expect(seeded?.enabled).toBe(false)
    await drainJobs(board.db, { now: new Date(Date.now() + 7 * 86_400_000) })
    expect((await jobsOf(board, seeded?.id ?? 0)).length).toBe(0)
    expect(await postsBy(board.db, routineActor)).toEqual([])
  })

  test("a routine's hourly limit and the board's total limit hold", async () => {
    const board = await freshBoard()
    const routine = await created(board, watcher({ perHour: 2 }))
    for (const text of ["a", "b", "c", "d", "e"]) await post(board, "backend", text)
    await drainJobs(board.db)
    const runs = await jobsOf(board, routine.id)
    expect(runs.filter((j) => j.state === "done").length).toBe(2)
    expect(runs.filter((j) => j.state === "skipped").every((j) => j.result === "Over its limit of 2 runs an hour")).toBe(true)
    expect(runs.length).toBe(5)

    const busy = await created(board, watcher({ name: "Busy", perHour: routineLimits.perHourMax }))
    await post(board, "backend", "one more")
    const now = new Date(Date.now() + 1000)
    await board.db.insert(jobs).values(
      Array.from({ length: routineLimits.totalPerHour - 2 }, (_, i) => ({
        kind: "routine" as const,
        key: `history-${i}`,
        routineId: busy.id,
        payload: { cause: { kind: "event", seq: 0, type: "message.posted" } },
        state: "done" as const,
        maxAttempts: 1,
        finishedAt: new Date(now.getTime() - 60_000),
      })),
    )
    await drainJobs(board.db, { now })
    const queuedRuns = () => board.db.select().from(jobs).where(and(eq(jobs.routineId, busy.id), like(jobs.key, "routine:%"))).orderBy(desc(jobs.id))
    const [latest] = await queuedRuns()
    expect(latest).toMatchObject({ state: "skipped", result: `Over the board's limit of ${routineLimits.totalPerHour} routine runs an hour` })
    const hourLater = new Date(now.getTime() + 3_600_000)
    await post(board, "backend", "an hour later")
    await drainJobs(board.db, { now: hourLater })
    expect((await queuedRuns())[0]?.state).toBe("done")
  })
})

describe("scheduled routines", () => {
  test("a scheduled routine fires once per due time, as a job, and posts the morning brief", async () => {
    const board = await freshBoard()
    const [brief] = z.array(Routine).parse((await board.call("simon", "GET", "/api/routines")).json)
    expect(brief).toMatchObject({ name: "Morning brief", enabled: false, trigger: { kind: "cron", schedule: "0 8 * * 1-5" }, action: { kind: "brief" } })
    const on = await created(board, { name: "Daily brief", channel: "reviews", trigger: { kind: "cron", schedule: "*/5 * * * *" }, action: { kind: "brief" } })
    const due = new Date(on.nextRunAt ?? 0)
    expect(due.getTime()).toBeGreaterThan(Date.now())
    expect((await drainJobs(board.db, { now: new Date(due.getTime() - 1000) })).scheduled).toBe(0)
    expect(await drainJobs(board.db, { now: due })).toMatchObject({ scheduled: 1, ran: 1 })
    expect(await drainJobs(board.db, { now: new Date(due.getTime() + 1000) })).toMatchObject({ scheduled: 0, ran: 0 })
    const [run] = await jobsOf(board, on.id)
    expect(run).toMatchObject({ state: "done", cause: { kind: "cron", scheduledFor: due.toISOString() } })
    const [routine] = await board.db.select().from(routines).where(eq(routines.id, on.id))
    expect(routine?.nextRunAt?.getTime()).toBe(due.getTime() + 5 * 60_000)
    const [posted] = await postsBy(board.db, routineActor)
    expect(posted?.channel).toBe("reviews")
    expect(posted?.body).toStartWith("Morning brief")
  })

  test("the brief summarises a seeded board: finished, blocked with reasons, and what waits for a person", async () => {
    const board = await freshBoard()
    const response = await board.call("tim", "GET", "/api/brief")
    expect(response.status).toBe(200)
    const brief = Brief.parse(response.json)
    expect(brief.finished.map((t) => t.id)).toEqual([818])
    expect(brief.blocked.map((t) => [t.id, t.reason])).toEqual([[298, "Waiting on finance to approve the spend"]])
    expect(brief.questions.map((t) => t.id)).toEqual([824])
    expect(brief.reviews.map((t) => t.id)).toEqual([816])
    expect(brief.text).toContain("#818 Set up the staging chat bot")
    expect(brief.text).toContain("#298 Upgrade to the paid email plan: Waiting on finance to approve the spend")
    expect(brief.text).toContain("codex asks on #824 Delete the paused ad campaign 'Spring test': Delete the paused ad campaign 'Spring test'?")
    expect(brief.text).toContain("Review #816 Lazy-load the provider registry from claude")
  })
})
