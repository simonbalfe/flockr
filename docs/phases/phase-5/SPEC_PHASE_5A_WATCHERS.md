# 5a Watchers

Phase 5, row 5a in the [master checklist](../SPEC_MASTER_CHECKLIST.md); parity P44. A watcher is a routine with an event trigger, built together with 5b Routines and 6c Morning brief on one jobs queue ([ADR 0020](../../decisions/0020-jobs-are-postgres-rows-drained-by-the-platform-scheduler.md)).

The scope, schema, routes, surfaces, rules the tests hold and exit checklist are in [SPEC_PHASE_5B_ROUTINES.md](SPEC_PHASE_5B_ROUTINES.md).

## In short

- A routine with `trigger: { kind: "event", eventType }` watches its channel: each new event of that type enqueues one job, in the same transaction as the event (`apps/server/src/board/watchers.ts`, called from `mutate`).
- The job runs the routine's one action when a drainer picks it up; off, deleted or over a limit, it is skipped.
- Events a routine's run writes never trigger a watcher.

## Notes from the build

See the combined spec's notes.
