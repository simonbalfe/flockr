# PL3 Board room object

Part of the Platform track ([README](README.md)); ADRs [0017](../../decisions/0017-flockr-runs-on-cloudflare-through-platform-adapters.md) and [0018](../../decisions/0018-durable-objects-are-disposable.md). Needs PL2.

## Problem

On Cloudflare no process can hold a `LISTEN` connection, so the Worker served `/ws` with a 501. Live events need one place per board that holds the open sockets and hears about new events, without board code knowing where that is.

## Scope

- `apps/server/src/platform/cloudflare/board-room.ts`: the `BoardRoom` Durable Object, one per board (`idFromName(boardId)`). It runs the same `createHub` as the Bun server, fed by a `pushListener` instead of Postgres. A WebSocket upgrade attaches a socket (`since=N` replays from Postgres); `POST /signals` pushes decoded `LiveSignal`s into the hub.
- `apps/server/src/platform/cloudflare/live.ts`: `cloudflareSignals`, which queues signals in a request-scoped outbox (`AsyncLocalStorage`), and `collectSignals`, which runs a request and returns what it queued.
- `apps/server/src/platform/live.ts`: `LiveSignal` is now a Zod schema (decoded where it enters the object), plus `pushListener`.
- `apps/server/src/platform/index.ts`: `liveSignals` delegates to the active implementation; `useLiveSignals` swaps it. The Bun entries keep Postgres; `worker.ts` switches to `cloudflareSignals`.
- `apps/server/src/worker.ts`: `/ws` goes to the board room; after an `/api` or `/mcp` request that succeeded, its signals go to the board room in `waitUntil`, so they arrive after the transaction committed.
- `wrangler.jsonc`: the `BOARD_ROOM` binding and a `v1` migration for the SQLite-backed class.
- Typecheck in two passes: `tsconfig.json` (Bun) excludes the Cloudflare files; `tsconfig.worker.json` checks `worker.ts` and `platform/cloudflare` with Workers and Node types.

**Out:** hibernating sockets (the object stays awake while a socket is open), more than one board, sign-in on the socket.

## Rules the checks hold

- A message posted through the Worker streams to an open `/ws` socket with its sequence number.
- A socket opened at an older sequence number replays the missed events, then the new one, in order.
- Wiping the object loses nothing: it keeps only open sockets, and events come from Postgres.

## Exit checklist

- [x] `bun run typecheck` passes both passes.
- [x] `bun run worker:smoke` passes, including the two live checks.
- [x] `bun run test` passes on Bun (server 55, runner 96, web 6).

## Notes from the build

- The hub needed no change: `createHub(db, listener)` from PL1 runs inside the object with a `pushListener`.
- Signals are only sent when the response is `ok`. A failed request may have queued signals from a transaction that rolled back; a stray head signal would only make the object re-read Postgres, but a stray agents or activity frame would be shown.
- `DurableObject` already has a `connect` method, so the socket method is `openSocket`.
- Without hibernation the object is billed while any socket is open. Hibernation needs the cursor kept in the socket attachment instead of the hub's map: a follow-up before real traffic.
- Added dev dependencies, each at least 14 days old: `@cloudflare/workers-types` 5.20261110.1 and `@types/node` 26.6.6.
