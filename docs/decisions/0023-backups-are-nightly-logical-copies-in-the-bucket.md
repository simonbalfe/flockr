# 0023: Backups are nightly logical copies in the bucket

Status: accepted, 25 Nov 2026. Decided by the agent building PL4, as a small reversible choice. Supersedes in part [0002](0002-r2-holds-files-and-postgres-backups.md): its "nightly base backup plus continuous WAL archive" method; R2 through the S3 API as the home for backups and files stands.

## Problem

0002 planned a base backup plus a WAL archive, which assumes Postgres on our own box. Postgres is now hosted on Neon behind Hyperdrive (PL4), where we cannot ship WAL, and the Worker that runs Flockr cannot run `pg_dump`. Neon's own history covers recent mistakes but sits with the same provider, so losing the account loses both.

## Options

| Option | Good | Cost |
|---|---|---|
| Neon's history only | Nothing to build, point-in-time restore | Same provider as the data; short window on small plans |
| `pg_dump` from a machine on a timer | Standard format | Needs a machine that is always on; the Worker cannot run it |
| A logical copy made by Flockr itself: every public table as JSON, gzipped, to the bucket from the nightly cron | Runs in the Worker and on Bun alike; any S3 bucket; restore is one command into an empty database | Whole copy in memory, so fine for a small board, not for gigabytes; no point in time between nights |

## Choice

The logical copy. At 03:00 UTC the Worker's second cron (`0 3 * * *`) writes `backups/<time>.json.gz` to the `FLOCKR_S3_*` bucket and keeps the newest 30. `bun run db:backup` takes one by hand; `bun run db:restore [key]` migrates `DATABASE_URL` and loads the newest (or named) backup, refusing a database that already has rows. Neon's history stays the first stop for a mistake within its window.

## Why

It needs no extra machine, works on every platform Flockr runs on (ADR 0017), and the bucket is plain S3 (`src/storage/s3.ts`, `aws4fetch`), so R2 can be swapped without code changes. A restore was practised against a local S3 server: 185 rows out and back, event log identical.

## Costs

- A backup reads every table in one transaction and holds it in memory; past roughly 50 MB of data, switch to streaming per table or to `pg_dump` from a machine.
- Up to a day of work can be lost if Neon's history is also gone.
- Restoring into a newer schema works (missing columns take their defaults); into an older one is refused.
- The bucket keys (`FLOCKR_S3_ACCESS_KEY_ID`, `FLOCKR_S3_SECRET_ACCESS_KEY`) are Worker secrets from Infisical.
