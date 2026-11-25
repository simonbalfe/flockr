# 0018: Durable Objects are disposable: no data lives only in one, and no board rules run in one

Status: accepted, 25 Nov 2026. Decided by Simon in chat. Builds on [0017](0017-flockr-runs-on-cloudflare-through-platform-adapters.md). Supersedes in part [0008](0008-pi-durable-is-the-built-in-agent-harness.md) (where a hosted agent's loop state lives).

## Problem

Durable Objects are the one Cloudflare piece with no portable equivalent. They lock in twice: code written against their API, and data kept in their storage. Pi Durable saves every model call and tool call before the next step, so where it writes decides both speed and lock-in.

## Options

| Option | Good | Cost |
|---|---|---|
| Pi writes to the Durable Object's SQLite only | Fastest (local, under 1 ms); Pi's built-in adapter | Agent memory exists only on Cloudflare |
| Pi writes to Postgres through Hyperdrive | No lock-in | 10 to 150 ms per step on the agent's path; a Postgres adapter for Pi to write |
| **Pi writes to the Durable Object's SQLite, and each step is copied to Postgres in the background** | Fast and portable | A copy to build; steps not yet copied live only on Cloudflare |
| Rivet 3.0 actors instead of Durable Objects | The same model, open source, S3-backed | Servers to run (see 0017) |

## Choice

- **Board room object, one per board:** holds connected WebSockets and the last sequence number pushed. Events live in Postgres; a client reconnects with `since=N`.
- **Agent object, one per cloud agent:** hosts Pi Durable on its own SQLite through Pi's Durable Object adapter. After each saved step it copies the new `pi_` rows to Postgres in the background, records the last row copied, and retries from an alarm when a copy fails. It also holds a run-in-progress flag, the alarm for the next routine and the current sandbox's id, all rebuildable from Postgres.
- **No board rules in an object.** An object calls plain functions from the core (for example `handleWake(agentId, message)`), and sits behind the agent host and live signal interfaces (0017).
- **The test:** wiping every Durable Object loses nothing but open connections; agents restore their history from Postgres.

## Why

Agents run at local SQLite speed, and everything needed to leave Cloudflare, or to restore a lost object, is already in Postgres.

## Costs

- A `pi_` row copy, its Postgres tables and a restore path to build and drill (PL5).
- A step written but not yet copied exists only in Durable Object storage until the copy runs; Cloudflare stores it durably, so this is a portability gap, not a loss risk.
- Whether Pi Durable exposes a hook after each saved step was not checked; without one the copy runs on a short alarm, about every 10 seconds.
- Agent history is in two places; Postgres is the copy that leaves with us, the object is the working copy.
