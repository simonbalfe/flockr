# 0020: Jobs are Postgres rows drained by the platform's scheduler, not pg-boss

Status: accepted, 25 Nov 2026. Decided while building Phase 5, as [0017](0017-flockr-runs-on-cloudflare-through-platform-adapters.md) left open ("decided in 5a"). Supersedes in part [0006](0006-postgres-is-the-data-store.md) (background jobs use pg-boss).

## Problem

Watchers (5a), routines (5b), approval steps (5c) and the morning brief (6c) need background jobs with retries. 0006 planned pg-boss, which needs a worker process polling Postgres all the time. On Cloudflare (0017) nothing runs all the time: work starts from a request, a Cron Trigger or a Durable Object alarm.

## Options

| Option | Good | Cost |
|---|---|---|
| pg-boss | Mature queue | Needs a long-lived worker; does not fit Workers |
| Cloudflare Queues | Managed retries | Cloudflare-only; the Bun path needs a second queue |
| **A `jobs` table in Postgres, drained by the platform scheduler** | Portable; claimed with `FOR UPDATE SKIP LOCKED` like tasks; one code path | We write retries and backoff ourselves |

## Choice

- **Jobs are rows:** kind, payload, run at, attempts, state (`queued`, `running`, `done`, `failed`), last error, lock expiry. A job is claimed with `FOR UPDATE SKIP LOCKED`, retried with backoff up to a limit, then failed with its error kept. Enqueuing happens in the same transaction as the event that caused it, so a job exists exactly when its event does.
- **Draining is a platform interface (`Scheduler`):** on Bun a timer in the server, like the lease sweeper; on Cloudflare a Cron Trigger every minute plus a Durable Object alarm for work due sooner. Both call the same `drainJobs()` from the core.
- **Routines are rows:** a trigger (a cron schedule, or an event type in a channel), one action (post a message, create a task, mention an agent, or post the morning brief), off until a person turns them on, and a rate limit per routine and in total. A watcher is a routine with an event trigger.
- **Nothing acts unless asked:** a new routine is off; anything that spends money or changes prod becomes a question card (5c).

## Why

The same queue runs on a laptop, in Docker Compose and on Cloudflare, with no extra service, and it reuses the claim pattern the board already trusts.

## Costs

- Retries, backoff and stuck-job recovery are ours to write and test.
- Throughput is bounded by Postgres; fine for a board, not for a firehose.
- Cron parsing is ours, or a small pinned dependency.
