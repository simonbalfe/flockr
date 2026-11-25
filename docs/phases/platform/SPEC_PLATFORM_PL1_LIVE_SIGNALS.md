# PL1 Live signals

Part of the Platform track ([README](README.md)); first step of [ADR 0017](../../decisions/0017-flockr-runs-on-cloudflare-through-platform-adapters.md).

## Problem

The live hub and two board writes talk to Postgres `LISTEN/NOTIFY` directly: `writeEvents` and `notifyAgents` call `pg_notify`, and `createHub` takes the raw `postgres` client to `listen`. On Cloudflare a Worker cannot hold a listening connection, so live events there come from a Durable Object (PL3). Until the board stops naming the mechanism, that swap means editing board code.

Example: today `writeEvents` runs ``tx.execute(sql`select pg_notify(...)`)``. After PL1 it calls `liveSignals.publish(tx, { kind: "head", board, head })`, and only the Postgres implementation knows about `pg_notify`.

## Scope

- `apps/server/src/platform/live.ts`: the `LiveSignal` union (`head`: the board's new last sequence number; `frame`: a live frame sent as is, such as the agents frame) and two interfaces: `LiveSignals.publish(tx, signal)`, called inside the write's transaction, and `LiveListener.listen({ onSignal, onResync })`, returning a stop function.
- `apps/server/src/platform/postgres/live.ts`: the Postgres implementation, the only file that names `pg_notify` or `listen`. Payloads are decoded with Zod where they enter; an unreadable head payload, and every (re)connect, call `onResync`, which pumps every socket from the database, as today.
- `apps/server/src/platform/index.ts`: the active implementation for the Bun entries. PL3 replaces this import with an injected publisher once a second implementation exists.
- `writeEvents`, `notifyAgents` and the activity presence write in `board/activity.ts` publish through `liveSignals`; `createHub` takes a database and a `LiveListener`; `startLive` and the events test wire the Postgres listener.

**Out:** the Durable Object implementation (PL3), publishing after commit (PL3), the import guard (PL9).

## Rules the tests hold

- Sequence numbers stay gapless under concurrent writes (existing test).
- The hub replays from `since` and then streams new events (existing test, now through `LiveListener`).
- An agents frame published inside a transaction reaches an attached socket.

## Exit checklist

- [x] No file outside `apps/server/src/platform/postgres/` contains `pg_notify` or calls `listen(`.
- [x] `bun run typecheck` and `bun run test` pass (server 55, runner 96, web 6).
- [x] `bun dev`: a message posted through the API arrives on a `/ws` socket opened at the head as `message.posted`.

## Notes from the build

- A third `pg_notify` call site existed: activity presence in `board/activity.ts`. It now publishes a `frame` signal like `notifyAgents`.
- Payloads are decoded with Zod in the Postgres listener. An unreadable activity payload is now dropped instead of throwing inside the listener callback; an unreadable head payload resyncs every socket, as before.
- `apps/server/src/platform/index.ts` is the one swap point for the Bun entries; PL3 replaces the module-level `liveSignals` with an injected publisher.
- The live check ran against `bun dev` restarted with `FLOCKR_NO_RUNNER=1`; it posted two `PL1 live check` messages to `#general` on the local board.
