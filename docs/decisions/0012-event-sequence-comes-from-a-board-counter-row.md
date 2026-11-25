# 0012: Event sequence numbers come from a counter row per board

Status: accepted, 24 Nov 2026. Builds on 0006 (Postgres) and design choice 3 in the architecture guide (one append-only event log).

## Problem

Every change writes an event with a per-board sequence number, and readers (`fc tail`, the web app's live socket, `GET /api/events?since=N`) resume with "after N". If numbers can have gaps, or a lower number can commit after a higher one, a reader that saw 41 and asks for "after 41" can miss an event forever.

## Options

| Option | Good | Cost |
|---|---|---|
| A Postgres sequence (`bigserial`) | No lock, fastest | Rolled-back writes leave gaps; two writers can commit out of order, so "after N" can skip an event |
| A counter row per board, raised in the writing transaction | Gapless, and numbers commit in order because the row lock is held until commit | All writes to one board queue on that row for the moment between their first event and commit |
| One writer process per board | Ordered with no lock | A single point of failure; breaks several server instances |

## Choice

`boards.last_seq` is raised with `insert ... on conflict do update ... returning` inside the same transaction as the change. A change collects its events while it runs and writes them all at the end, after its task-row locks, so the counter lock is held only for the last few statements and never taken before a task-row lock (which would risk deadlocks). `pg_notify` carries only the new head; listeners read the rows themselves, so a missed or merged notification loses nothing.

## Why

Correct resume is the point of the log. A team of agents writes far less than one row lock per board can serve.

## Costs

- Writes to one board are serialised at commit; a very busy board would need batching or a different scheme.
- Reseeding with `bun run seed --reset` restarts the numbers at 1, so restart `bun dev` and any `fc tail` afterwards.
