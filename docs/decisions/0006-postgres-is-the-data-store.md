# 0006: Postgres is the data store

Status: accepted, 24 Nov 2026. Supersedes [0004](0004-sqlite-is-the-data-store-for-now.md). Restores the Postgres choice in [0001](0001-flockr-runs-on-a-vps-not-cloudflare.md) and the backups in [0002](0002-r2-holds-files-and-postgres-backups.md).

## Problem

0004 chose SQLite for the smallest MVP. Simon prefers Postgres: it allows several servers, richer reports across workspaces and search from day one, and avoids a migration later.

## Options

| Option | Good | Cost |
|---|---|---|
| Postgres | Several servers, `LISTEN/NOTIFY`, row-lock claims, full-text search, plain SQL reports, no later migration | A second service to run, secure and back up; Docker needed locally |
| SQLite | One file, nothing to run | Single server only; a migration if the product grows |

## Choice

Postgres through Drizzle, run in Docker Compose locally and on the VPS. Live events use `LISTEN/NOTIFY`, claims use `FOR UPDATE SKIP LOCKED`, background jobs use pg-boss. Backups go to Cloudflare R2 (nightly base backup plus WAL archive); attached files also go to R2. Bun's built-in Postgres client or `postgres` can be used underneath Drizzle.

## Why

It removes the later migration and the single-server ceiling, at the cost of one extra container.

## Costs

- Local development needs a running Postgres (Docker).
- The restore from R2 must be practised once before relying on it.
- The frontend-first build is unaffected: it uses a fake data layer.
