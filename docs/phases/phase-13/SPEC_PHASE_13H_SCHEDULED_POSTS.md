# 13h Scheduled posts

Row 13h in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P10.

## Problem

Example: Simon wants "Standup in 5" posted in `#backend` at 09:55 tomorrow, and the lead agent wants to remind `#acme-site` when the launch window opens. A routine can post on a cron schedule, but a one-off post at a time needs a routine made and deleted by hand.

## Scope

- **A post job:** `jobKinds` gains `post`. `schedulePost` (`POST /api/channels/{channel}/scheduled`, `{ text, at, key? }`) enqueues one job with `run_at = at` and payload `{ channel, text, by }`, under the key `post:<member>:<key>`, so a retry with the same key returns the first schedule (other text or time under it is 400). `at` is in the future and at most `scheduleLimits.maxDays` (365) days ahead. `post.scheduled` is the event, in the channel.
- **Posting:** the job drainer (the Bun timer, or the Worker's minute cron) runs it within about a minute of `at`. In one transaction it locks the job by its attempt fence, checks the author is still a member who can see the channel, posts as the author through `postIn` (the same path as `postMessage`: mentions, direct messages, `message.posted`, so agents are woken as by any post) and marks the job done with the message id. An author who lost the channel is skipped with the reason; nothing posts.
- **Cancel:** `cancelScheduledPost` (`POST /api/channels/{channel}/scheduled/{id}/cancel`) by the author only, while it is queued; the job becomes skipped ("Canceled by simon"), `post.schedule_canceled` is the event, a repeat returns it, and after it posted it is 409.
- **Your list:** `listScheduledPosts` (`GET /api/me/scheduled`): your posts still waiting, soonest first. Scheduled posts are private to their author until they post.
- **Out:** editing a scheduled post (cancel and schedule again), scheduled replies in a thread, recurring posts (routines).

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `schedulePost`, `listScheduledPosts`, `cancelScheduledPost` |
| `flockr` | `schedule <channel> <text> --at <time\|+30m\|+2h\|+1d>`, `scheduled`, `scheduled cancel <channel> <j12>` |
| Web app | A clock in the channel composer opens a schedule dialog; Drafts & sent has a Scheduled tab with cancel |
| Board skill | Schedule a reminder instead of keeping a run alive |

## Rules the tests hold

`apps/server/test/scheduled.test.ts`:

- A post scheduled an hour ahead is not posted by a drain now, is posted once as its author by a drain after its time (two drains, one post), and leaves the list; a retry with the same key returns the same id; canceling after it posted is 409.
- Only the author cancels (403 for another member, 404 in the wrong channel); a canceled post never posts; canceling twice is 200.
- A time in the past is 400; `ana` (acme) cannot schedule in `#backend` (403); removed from `#acme-site` before the time, her post never posts.

## Exit checklist

- [x] `post` job kind and runner, schedule, list, cancel
- [x] `bun run generate`, MCP, `flockr schedule` and `scheduled`
- [x] Web schedule dialog and Scheduled tab
- [x] Tests above; `bun run check`
- [x] Board skill, master checklist row, parity row P10

## Notes from the build

- `postMessage` was split into `postIn(tx, emit, ...)` and the transaction around it, so the drainer posts in the same transaction that marks the job done, as ADR 0020 asks of every job.
- The jobs table needed no migration: `kind` has no check constraint, and the job states map onto what a person sees (`queued`, `running`, `waiting` show as scheduled, `done` as posted, `skipped` as canceled, `failed` as failed).
- The job events (`job.finished` and the rest) carry no channel, as for routines, so only the host org sees them; the post itself is an ordinary `message.posted` in its channel.
- A drainer still running older code (a dev server started before this change, or an instance mid-deploy) has no `post` runner: the job fails its attempt and retries with backoff, and a current drainer posts it on the next try. Restart long-running dev servers after pulling; on deploy it heals by itself within the retry budget.
