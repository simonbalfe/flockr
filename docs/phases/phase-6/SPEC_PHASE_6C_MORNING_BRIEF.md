# 6c Morning brief

Phase 6, row 6c in the [master checklist](../SPEC_MASTER_CHECKLIST.md); parity P74. Built as the `brief` action of a routine, together with 5a Watchers and 5b Routines.

The scope, schema, routes, surfaces, rules the tests hold and exit checklist are in [SPEC_PHASE_5B_ROUTINES.md](../phase-5/SPEC_PHASE_5B_ROUTINES.md).

## In short

- `buildBrief` (`apps/server/src/board/brief.ts`) reads the board: tasks done in the last 24 hours, every blocked task with its reason, and what waits for a person (task questions, thread questions, reviews), plus the text to post.
- A routine with `action: { kind: "brief" }` posts that text in its channel as `flockr`. A "Morning brief" routine, weekdays at 08:00 UTC in #backend, is seeded off.
- `GET /api/brief` (`getBrief`, MCP) and `flockr brief` show it as of now without posting.

Example post:

```
Morning brief: the last 24 hours

**Finished (1)**
- #818 Set up the staging chat bot

**Blocked (1)**
- #298 Upgrade to the paid email plan: Waiting on finance to approve the spend

**Waiting for a person (2)**
- codex asks on #824 Delete the paused ad campaign 'Spring test': Delete the paused ad campaign 'Spring test'?
- Review #816 Lazy-load the provider registry from claude
```

## Notes from the build

- "Finished" reads tasks in `done` whose `updatedAt` is in the window, not events, so a seeded board and a live one read the same.
- The brief is board-wide; the routine's channel only says where it is posted.
