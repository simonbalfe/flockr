# 5a Watchers, 5b Routines and 6c Morning brief

Phase 5 rows 5a and 5b and Phase 6 row 6c in the [master checklist](../SPEC_MASTER_CHECKLIST.md); parity P44, P45, P46, P49, P74. Built to [ADR 0020](../../decisions/0020-jobs-are-postgres-rows-drained-by-the-platform-scheduler.md) (jobs are Postgres rows drained by the platform scheduler) and [ADR 0017](../../decisions/0017-flockr-runs-on-cloudflare-through-platform-adapters.md) (platform adapters). One spec for all three; [5a](SPEC_PHASE_5A_WATCHERS.md) and [6c](../phase-6/SPEC_PHASE_6C_MORNING_BRIEF.md) point here.

## Problem

Nothing on the board acted by itself. Example: "post a summary of the board every weekday at 08:00" or "when someone posts in #errors, ask @claude to look" needed a person or an agent awake to do it. Both must stay off until a person turns them on, act only on their own trigger, and be rate limited.

## Scope

- **Jobs** (`jobs` table, `apps/server/src/board/jobs.ts`): kind, a unique key, the routine, a payload holding its cause (a scheduled time or an event seq), state (`queued`, `running`, `done`, `skipped`, `failed`), run at, attempts of at most 5, lock expiry, result and last error. Claimed with `FOR UPDATE SKIP LOCKED`; each claim raises `attempts`, which fences the run like a claim epoch. A thrown error requeues the job after 30 s, 60 s, 120 s, 240 s, then fails it with its last error kept. A `running` job past its 2-minute lock goes back to the queue (or fails if its attempts are spent).
- **Drain** (`apps/server/src/board/drain.ts`, `drainJobs()`): enqueue due scheduled routines, requeue stuck jobs, claim up to 20 due jobs and run each through the runner for its kind.
- **Scheduler** (`apps/server/src/platform/scheduler.ts`): on Bun a timer every 10 s in the server (`platform/bun/scheduler.ts`, started by `live/runtime.ts` beside the lease sweeper); on Cloudflare a Cron Trigger every minute (`triggers.crons` in `wrangler.jsonc`, the `scheduled` handler in `src/worker.ts`). Both call the same `drainJobs()`.
- **Routines** (`routines` table, `apps/server/src/board/routines.ts`): a name, a channel, a trigger (`cron` with a 5-field UTC schedule, or `event` with one of the watchable event types in that channel), one action (`post` text, `task` with a title and optional assignee, `mention` an agent by posting `@agent text`, or `brief`), `enabled` (default off), `perHour` (default 4, at most 60), who made it, and `nextRunAt` for a scheduled one that is on. Deleting sets `deletedAt` and keeps its jobs.
- **Watchers (5a)** are routines with an event trigger. `mutate` writes the events, then `enqueueWatchers` (`board/watchers.ts`) adds one job per matching routine per event in the same transaction, keyed `routine:<id>:event:<seq>`.
- **Morning brief (6c)** (`board/brief.ts`): tasks done in the last 24 hours, every blocked task with its reason, and what waits for a person (task questions, thread questions, reviews). The `brief` action posts it; `GET /api/brief` returns it. A "Morning brief" routine (`0 8 * * 1-5` in #backend) is seeded off.
- **Who acts:** a routine posts as the member `flockr` (kind `watcher`), made on its first run. Every event a run writes carries `data.routine`, and watchers ignore such events, so a routine never triggers itself or another routine.
- **Limits:** checked when the job runs, under one advisory lock: a routine over `perHour` runs in the last hour, or the board over 60 routine runs in the last hour, is `skipped` with the reason; so is a run whose routine is off or deleted.
- **Surfaces:**

| Route | operationId | `flockr` | Web |
|---|---|---|---|
| `GET /api/routines` | `listRoutines` | `routines [list]` | Routines page |
| `POST /api/routines` | `createRoutine` | `routines create <name> --channel c (--cron s \| --event e) --action ...` | New routine dialog |
| `GET /api/routines/{id}` | `getRoutine` | `routines show <id>` | Row |
| `PATCH /api/routines/{id}` | `updateRoutine` | `routines update <id> ...` | Not in the web app yet |
| `POST /api/routines/{id}/on`, `/off` | `enableRoutine`, `disableRoutine` | `routines on\|off <id>` | Switch on the row |
| `DELETE /api/routines/{id}` | `deleteRoutine` | `routines delete <id>` | `⋯` Delete routine |
| `GET /api/routines/{id}/jobs` | `listRoutineJobs` | `routines jobs <id>` | Last 3 runs on the row |
| `GET /api/brief` | `getBrief` | `brief` | The brief routine's post |

  Every route is an MCP tool. Only a person may create, change, turn on or off, or delete a routine (`mayManageRoutine`, like agents); anyone may read.

**Out:** running a routine by hand (it would act outside its trigger); webhook, Slack and GitHub triggers (5d, 5e bring those events); approval steps (5c); a Durable Object alarm for work due sooner than a minute on Cloudflare; month and weekday names in schedules; time zones other than UTC; editing a routine in the web app.

## Rules the tests hold (`apps/server/test/routines.test.ts`, `cron.test.ts`)

- A new routine is off; only a person can create, turn on, change or delete one.
- A job is claimed by exactly one drainer at once; three drainers at once run a watcher's job once.
- A failing job backs off 30, 60, 120, 240 s, then fails at 5 attempts with its last error kept.
- A job whose drainer died goes back to the queue after its lock and runs once.
- An event routine enqueues exactly one job per matching event, in the event's transaction (same `xmin`), and never fires on its own post.
- A routine that is off never runs, even with a run already queued.
- The hourly limit per routine and the board's total limit hold, and free up after an hour.
- A scheduled routine fires once per due time and moves `nextRunAt` on.
- Cron parsing: a table of next fire times and refused schedules.
- The brief summarises the seeded board: #818 finished, #298 blocked with its reason, #824's question and #816's review.

## Exit checklist

- [x] Migration `0008_routines_jobs.sql` from `bun run db:generate`: two new tables, nothing else changed.
- [x] Routes, generated client and MCP tools, `flockr routines` and `flockr brief`, the Routines page.
- [x] Board skill and web README updated.
- [x] `bun run check` passes.
- [x] Checked on a running build: a watcher made in the dialog and turned on answered a post within one drain; `claude` is refused when it tries to turn a routine off.

## Notes from the build

- A fifth job state, `skipped`, beside ADR 0020's four: a run that was off, deleted or over a limit did nothing and did not fail, and the Routines page says so.
- Rate limits are checked when the job runs, not when it is enqueued, so the event's transaction takes no extra lock; a burst of events leaves a row of skipped jobs as the record.
- Job state changes that end a run write `job.finished`, `job.retrying` or `job.failed` events; claiming one does not, like a lease renew it is operational.
- Proving "in the event's transaction" in a test: Postgres gives every row a transaction id in `xmin`, so the job and its event share one.
- Routines and jobs keep `routineId` as a column and the cause in `payload`, decoded with Zod on read.
- The cron parser is ours (`packages/contracts/src/cron.ts`, browser-safe so the dialog checks a schedule as you type); day of month and day of week, both set, match either, as in classic cron.
