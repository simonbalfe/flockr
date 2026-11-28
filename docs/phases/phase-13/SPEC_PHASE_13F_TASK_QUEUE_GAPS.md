# 13f Task queue gaps

Row 13f in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P16, P17 and P27.

## Problem

Example: `acme-bot` over MCP wants the next `frontend` task and has to poll `claimNextTask` in a loop, because only `flockr tasks claim --wait` waits, client side over the live socket. When claude gives up on #820 it becomes "blocked" with a `Failed:` reason, indistinguishable in lists from a task waiting on finance; a task nobody needs any more can only be blocked forever. And the lead agent that split the users API into four tasks cannot wait for all four to finish.

## Scope

- **Claim with a wait (P17):** `claimNextTask` takes `wait` (seconds, at most `waitLimits.maxSeconds`, default 0). The server tries the claim, and while there is none and time is left, polls every `waitLimits.pollMs` and tries again. So `flockr`, MCP and the API share one wait. The same rules as an immediate claim: oldest ready first, `SKIP LOCKED`, labels, `mine`, a key's channel limit, exactly one winner.
- **Failed and canceled (P16):** `taskStates` gains `failed` and `canceled` (migration `0027_failed_canceled` widens the check).
  - `failTask` now sets `failed` (holder cleared, `reason` the failure), not `blocked`.
  - `cancelTask` (`POST /api/tasks/{id}/cancel`, `{ reason }`) ends a task that is not done or canceled; a person cancels any task, an agent only one it holds or is assigned. Its claim and areas end. Tasks that need it stay waiting, and the thread says so.
  - `reopenTask` (`POST /api/tasks/{id}/reopen`) brings a failed or canceled task back to ready, or waiting when its needs are not done; a person only.
  - Every `Record<TaskState, ...>` across the web app, the runner and the CLI learns both states (the compiler lists each).
- **Wait on a plan (P27):** `waitForPlan` (`GET /api/plans/{id}/wait?timeout=`) returns when every task of the plan is done or canceled, or when the timeout passes; the result has the plan, `finished`, and the open task ids. `failed` counts as open: a failed task needs a decision.
- **Out:** waiting for any one task of a plan, priorities in the queue, retry counts.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `wait` on `claimNextTask`; `cancelTask`, `reopenTask`; `waitForPlan`; `failed`, `canceled` in `TaskState` |
| `flockr` | `tasks claim --ready --wait --timeout s` uses the server wait; `tasks cancel <id> --reason`, `tasks reopen <id>`; `plans wait <id> [--timeout s]` |
| Web app | Failed and canceled states with their own dot and label; Cancel in the task actions; Reopen on a failed or canceled task |
| Board skill | Claim with a wait; fail versus block versus cancel; wait on a plan |

## Rules the tests hold

`apps/server/test/queue.test.ts`:

- A claim with `wait: 2` and nothing ready returns the task made one second later; with a label it ignores a task without it; it times out with null.
- Two agents waiting at once on one new task: exactly one gets it.
- `failTask` sets `failed`; `listTasks?state=blocked` no longer lists it; `reopenTask` by a person makes it ready, by an agent is 403.
- `cancelTask` by the holder ends the claim; by an unrelated agent is 403; a canceled task cannot be claimed.
- `waitForPlan` with one task left times out with it listed; after it is done the wait returns finished at once; a canceled task counts as finished, a failed one does not.

## Exit checklist

- [x] States, migration, `failTask` to failed, `cancelTask`, `reopenTask`
- [x] Server claim wait; `waitForPlan`
- [x] `bun run generate`, MCP, `flockr` commands
- [x] Web states and controls; runner maps
- [x] Tests above; `bun run check`
- [x] Board skill, master checklist row, parity rows P16, P17, P27

## Notes from the build

- The server waits by polling every `waitLimits.pollMs`, as `waitForEvents` does, rather than listening for task events: it needs no new live path, works the same on Bun and the Worker, and `SKIP LOCKED` keeps two waiting claimers to one winner (the race test).
- `flockr tasks claim --wait` now loops over the server wait in calls of at most 120 seconds, so its `--timeout` can be longer than one call; it no longer opens a live socket.
- Focus "needs you" lists failed tasks beside blocked ones (they need a person to reopen or cancel); its card says Failed and offers Reopen.
- The Kanban keeps six lanes: failed tasks show in Blocked and canceled ones in Done, each with its own dot (a cross, a struck-out square).
- A canceled task's dependants stay waiting and the thread names them; reopening the task is how they can start again. Removing the need is a later change if it is wanted.
