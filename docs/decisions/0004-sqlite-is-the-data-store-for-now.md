# 0004: SQLite is the data store for now

Status: superseded by [0006](0006-postgres-is-the-data-store.md). Was accepted 24 Nov 2026. Supersedes the Postgres choice in [0001](0001-flockr-runs-on-a-vps-not-cloudflare.md) and the Postgres backups in [0002](0002-r2-holds-files-and-postgres-backups.md). R2 for attached files still stands.

## Problem

The plan named Postgres, but the MVP is one server on one Mac or VPS. Postgres adds a second service to run, secure and back up for no gain at that size.

## Options

| Option | Good | Cost |
|---|---|---|
| SQLite (one file) | Nothing to run; claims are safe with one writer; built-in full-text search; Litestream streams it to R2 | Single server only; heavy cross-workspace reports are harder |
| Postgres | Several servers, rich reporting | A second service, passwords, tuning, WAL archiving |
| Turso (hosted SQLite) | Managed copies, several servers | Network delay and a vendor for no MVP gain |
| Rivet actors | One small database per agent or board | Extra moving part before cloud agents exist |

## Choice

SQLite through Drizzle, in one file. Litestream copies it to Cloudflare R2 continuously as the backup. R2 also holds attached files. Live events go from server memory; background jobs use a `jobs` table.

## Why

It covers the whole MVP with the least to run. Drizzle supports both SQLite and Postgres, so the move later is a one-time migration.

## Costs

- One server process only. A second server means moving to Postgres.
- Reports across many workspaces would be slow until then.
- The restore from R2 must be practised once before relying on it.
