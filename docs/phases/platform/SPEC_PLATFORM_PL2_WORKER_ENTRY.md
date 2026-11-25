# PL2 Worker entry

Part of the Platform track ([README](README.md)); [ADR 0017](../../decisions/0017-flockr-runs-on-cloudflare-through-platform-adapters.md). Needs PL1.

## Problem

Flockr's API only runs under Bun (`main.ts`, `dev.ts`). To run on Cloudflare the same app needs a Worker entry that reaches Postgres through Hyperdrive, without board code learning about Workers.

## Scope

- `apps/server/src/worker.ts`: the Worker entry. It decodes the bindings with Zod once, opens a Postgres connection per request from `env.HYPERDRIVE.connectionString`, serves `/api/*` and `/mcp` with the unchanged `createApp(db)`, and closes the connection with `ctx.waitUntil`. `/ws` answers 501 until PL3.
- `apps/server/src/platform/cloudflare/env.ts`: the bindings schema (`WorkerEnv`) and the execution context type, so no Cloudflare type package is needed yet.
- `apps/server/src/platform/cloudflare/db.ts`: `connectWorker`, a `postgres` client sized for Workers (`max: 5`, `fetch_types: false`).
- `apps/server/wrangler.jsonc`: `nodejs_compat`, the Hyperdrive binding with a placeholder id and a local connection string to the dev database. The real id arrives with PL4 (Neon).
- `bun run worker:dev` (`wrangler dev --port 8787`) and `bun run worker:smoke` in `apps/server`.

**Out:** live events (PL3), the web app's static files on Workers, deploys (PL10), the hosted database (PL4).

## Rules the checks hold

- Sequence numbers stay gapless when 27 writes arrive at once through the Worker.
- Two claims at once never take the same task.

## Exit checklist

- [x] `bun run worker:dev` serves `/api/openapi.json` through Hyperdrive to local Postgres.
- [x] `bun run worker:smoke` passes against the test database (start `worker:dev` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` set to `TEST_DATABASE_URL`).
- [x] `/mcp` answers `initialize` and `tools/list` on the Worker.
- [x] The Bun entry still passes `bun run test` and `bun run typecheck`.

## Notes from the build

- wrangler 4.160.0, the newest release at least 14 days old on 25 Nov 2026.
- The app needed no change: `createApp` had no Bun-only code, and `postgres` and Drizzle run under `nodejs_compat`.
- Smoke run: 25 messages and 2 claims at once gave 26 gapless events (25 messages, 1 claim); the second claim found no other ready task and returned none.
- Hyperdrive's local mode is a plain connection string; pooling and caching are only exercised once PL4 creates the real Hyperdrive config.
