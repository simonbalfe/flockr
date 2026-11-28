# Phase 13: Board and tasks

Rows 13a to 13h in the [master checklist](../SPEC_MASTER_CHECKLIST.md). Parity rows by id: [SPEC_COMPETITOR_PARITY](../SPEC_COMPETITOR_PARITY.md).

**Goal (Simon, 28 Nov 2026):** flesh out the message board and the task system before cloud agents, Slack sync and the rest of Phase 11, so people and agents can hand work to each other, check it and agree on it through the board alone.

**Done when:** in `#backend`, claude submits #812 at commit `a1b2c3d` naming codex as reviewer; codex reads the channel document, finds the hand-off record and approves at `a1b2c3d`; a second approval after claude pushes `e4f5a6b` is refused until codex looks again; and Simon sees from the channel who is behind on reading, without asking anyone.

Takes over 11e (living document per channel, typed blocks, read cursors across orgs) from [Phase 11](../phase-11/README.md).

## Rules every sub-phase keeps

- **Nothing crosses orgs.** Every new route names a channel, task, thread or message in its path, so the request guard (`apps/server/src/auth/scope.ts`) checks `canSee` before the handler runs; every new list filters with `visibleTo` (`apps/server/src/board/visibility.ts`); every new event carries its channel, so the live socket delivers it only to viewers who can see it. A member named in a write (reviewer, question target, cursor owner) must see the channel (`requireSeesTask`).
- **Every surface.** Route with `operationId`, `bun run generate`, the MCP tool from the same document, a `flockr` command, a web control, and the board skill when agents see it.
- **Repeat-safe and logged.** A retried call changes nothing twice, and every change is one event written in the same transaction.

## Sub-phases, in order

| Sub-phase | Focus | Covers | Why this order |
|---|---|---|---|
| 13a Review that holds | Only someone other than the submitter approves: a person, or the agent named as reviewer; an approval names the commit it approves and is refused once a newer one lands; at most 2 open reviews per reviewer agent and 2 tasks in review per submitting agent; the named reviewer is woken | P68, P70, P103 | The one half-built rule that is wrong today: any member, including the agent that did the work, can approve it. Every later hand-off and sign-off leans on review meaning something |
| 13b Channel document | One short living document per channel that people edit and agents read first and update; each edit names the version it replaces, so two edits never both win; every version readable | P99, P14, P121, P129 | The biggest gap for shared work: today the current plan lives in scattered messages or in memory items. Its versioned write is the pattern 13c reuses |
| 13c Typed blocks and hand-off records | Messages carry typed blocks checked against one schema list in `packages/contracts`: approval, deliverable, decision, hand-off; the hand-off card becomes a hand-off block with summary, branch, commit, files, tests run and next steps, readable as data | P11, P81 | Needs 13a's approval at a commit and 13b's versioned write; turns cards agents parse from text into data |
| 13d Questions between members | A question addressed to any member, agent or person, stays open until that member answers; listed in each member's inbox and Focus; permission cards still need a person | P83 | Agents already ask people; asking each other closes the loop that hand-offs and reviews open |
| 13e Read cursors and backlog | Each member's read cursor and backlog per channel, shown to whoever can see the channel, across orgs; the board skill and the runner move the cursor as they read; PL12's stuck flag reads the same field | P101 | Shows who is behind once 13b to 13d add more to read; the stuck flag in PL12 waits on it |
| 13f Task queue gaps | Claim the oldest ready task by label with a wait on every surface (server long-poll, so MCP gets it); canceled as a task state and failed kept apart from blocked; wait until every task of a plan is done | P16, P17, P27 | Builds on 11b's `waitForEvents`; small fixes once the review and record work is in |
| 13g Reactions and files | Reactions on any message as events; files attached to a post through the object store, each download checked with `canSee` | P8, P9 | Useful but not blocking collaboration; files need the bucket that PL5 already uses |
| 13h Scheduled posts | Post once at a set time through the job table, cancel before it runs | P10 | Routines already post on a cron schedule; a one-off post is the rest |

Specs: [13a](SPEC_PHASE_13A_REVIEW_THAT_HOLDS.md), [13b](SPEC_PHASE_13B_CHANNEL_DOCUMENT.md), [13c](SPEC_PHASE_13C_TYPED_BLOCKS.md). The rest are written one at a time, each from what the one before taught.

## Out of this phase

| Row | Why |
|---|---|
| P95, P96 shared threads with live code | 11g, after the cloud sandbox (4d) |
| P5 wait tool, P100 request key per post, P120 resync, P128 other orgs' agents never wake ours | Done in 11b |
| P2 stream and forum channels, P12 comments pinned to edits | No near need; P12 needs edit ids from a code store Flockr does not have |
| P69 agents suggest tasks | A lead agent can already make tasks and plans (12b); revisit once a lead runs end to end |
| P84 one space per repository | Phase 8 covers the coordination; mapping worktrees to a channel is a runner setting, not a board feature |
| P102 lanes, P104 merge on a benchmark, P105 the board owns the code, P106 swarm-wide work cap | Swarm scale; PL12 holds the guards Flockr needs first |

## Audit, 28 Nov 2026

Every row of "Messages and threads" and "Tasks and coordination" the brief named, checked in the code; P5, P100 and P120 rechecked after 11b landed. Rows that exist on `main` also carry the note in the parity file. P95, P96 and P99 to P106 are only in the main checkout's uncommitted parity edits, so their audit lives here.

| Row | Status | Proof, and what each surface lacks |
|---|---|---|
| P1 | Done | Channels, threads and one gapless event log (`apps/server/src/board/events.ts`, `events.test.ts`, 1b) |
| P2 | Missing | One channel kind (`channels.kind` is `channel` or `dm`) |
| P3 | Done | `messages.mentions`, the runner wakes the named agent (2e; `board.test.ts` "a mention records who it names") |
| P4 | Partial | The runner sends a reply into a live streaming session, else queues it for after the run (`converse` in `apps/runner/src/runner.ts`); the web reply box says "Steer"; no test of the live send |
| P5 | Done (11b) | `waitForEvents` (`GET /api/wait`) on a thread, a channel or your mentions with a timeout and a cursor, `flockr wait`, the MCP tool (`connect.test.ts`); no web control, as people get the live feed |
| P6 | Done | `listEvents` `?since=N`, live socket catch-up, `flockr tail` (`events.test.ts`) |
| P7 | Done | Labels on messages and tasks, `?label=`, `flockr label`, the web label editor (`messages.test.ts`, 1b) |
| P8 | Missing | No reactions anywhere |
| P9 | Missing | The object store (`apps/server/src/storage/`) holds only session chunks and backups |
| P10 | Partial | A routine with a cron trigger and a `post` action posts on a schedule (`routineActionKinds`); no one-off post at a time |
| P11 | Done (13c) | Typed blocks on messages from one list (`blocks.ts`), `blocks.test.ts` |
| P12 | Missing | No edit ids for code |
| P13 | Partial | Sub-threads one level under a reply (`messages.test.ts` "sub-threads", 2b); no copy of the code per sub-thread |
| P14 | Done (13b) | The channel document, `flockr doc`, the web Doc dialog |
| P15 | Done | `searchBoard`, `flockr search`, the web command palette (`search.test.ts`, 6b) |
| P16 | Partial | States waiting, ready, claimed, blocked, review, done (`taskStates`); fail sets blocked with a `Failed:` reason (`failTask` in `apps/server/src/board/flow.ts`); no canceled state; the web has no fail or submit control (agents' actions) |
| P17 | Partial | `claimNextTask` takes labels and picks the oldest ready with `SKIP LOCKED` (`claims.ts`, `claims.test.ts`); the wait is only `flockr tasks claim --wait`, client side over the live socket; no wait on the route or MCP; the web claims one task by id. 13f |
| P18 | Done | 15-minute lease, `renewTask`, the sweeper returns expired claims to ready (`sweepExpiredClaims`, `claims.test.ts`) |
| P19 | Done | `claimEpoch` per claim, `checkEpoch` refuses a stale holder (`write.ts`, `claims.test.ts`) |
| P20 | Done | One locked update claims; expired leases return to ready (`claims.test.ts` "two parallel claims ... exactly one wins") |
| P21 | Done | `needs`; `startReadyTasks` in `flow.ts` (`claims.test.ts` "completing #806 turns #808 ready") |
| P22 | Done | `assignee`, `flockr tasks create --for`, `giveTask`, the web Give control |
| P23 | Done | `handOffTask` and `giveTask` (8c), `flockr tasks handoff\|give`, the web hand-off dialog |
| P24 | Done | A mention starts a conversation, never a task (2e, ADR 0014) |
| P25 | Done | `task_commits`, `flockr tasks commit`, a branch per task (3d, 8b; `commits.test.ts`) |
| P26 | Done | Agent notes with kinds (10a) |
| P27 | Missing | Plans group tasks with progress (12a), but nothing waits on all or any of them |
| P68 | Done (13a) | `submitForReview`, `approveTask`, `requestChanges` on every surface; the Kanban review column and Focus "needs you" (`review.test.ts`); only a person or the named reviewer approves, never the submitter; no reminders |
| P69 | Missing | |
| P70 | Partial (13a) | An approval names its commit and is refused once a newer one lands; no "agreed incomplete" end |
| P71 | Partial | An edit is a new version (`listMessageVersions`); a delete leaves a tombstone and the event stays (`delete.test.ts`); deleting is allowed on purpose |
| P80 | Partial | The runner queues messages for an agent that is working, at its session limit or paused, and sends them when it settles (`queued` in `runner.ts`, `service.ts`); an agent over MCP gets no such queue |
| P81 | Done (13c) | The hand-off record is a block with files and tests, read with `listBlocks` |
| P82 | Partial | Agent notes and channel memory with kinds dead-end, decision, fact, archived not deleted (10a, 10b, `memory.test.ts`); no "superseded by" link, no lookup scoped to a task |
| P83 | Partial | `askInThread` and task questions stay open and show in the inbox and Focus (`conversation.test.ts`); only a person answers, so agents cannot ask each other. 13d |
| P84 | Partial | A channel names its repo (`channels.repo`) and the runner works a task in a worktree on `flockr/<id>`; nothing maps a worktree to its channel |
| P95 | Missing | 11g |
| P96 | Missing | 11g |
| P99 | Done (13b) | `getChannelDocument`, `editChannelDocument`, `listDocumentVersions`; the runner puts it atop every prompt (`documents.test.ts`) |
| P100 | Done (11b) | `postMessage` and `replyToThread` take a key; a retry posts once, new text under a used key is 409 (`connect.test.ts`) |
| P101 | Partial | `reads.last_read_id` per member and channel gives the reader its own unread counts (`markRead`, `board.test.ts`); nobody sees another member's cursor or backlog. 13e |
| P102 | Missing | Channels only |
| P103 | Done (13a) | A named reviewer per task, at most 2 open reviews per reviewer agent and 2 tasks in review per submitting agent (`reviewLimits`) |
| P104 | Missing | |
| P105 | Missing | |
| P106 | Missing | |
| P120 | Done (11b) | A `resync` frame after the hub reconnects, and the client refetches |
| P121 | Done (13b) | The channel document's edit names the version it replaces (`stale_version`); message edits stay author only |
