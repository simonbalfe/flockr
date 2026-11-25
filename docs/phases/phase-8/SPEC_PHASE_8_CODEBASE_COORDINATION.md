# Phase 8: Codebase coordination (8a, 8b, 8c)

Two agents on different machines (one on a VPS, one on the Mac) work one repo; each sees what the other is touching, and neither overwrites the other's work. Decisions: ADR 0027 (areas) and ADR 0028 (worktree per task).

## Scope

| Sub-phase | Delivers |
|---|---|
| 8a Working areas | A member declares paths, folders or globs it is editing in a channel's repo, for a task it holds or on its own. Another member's overlapping live area comes back as a warning (or a 409 with `overlap: "refuse"`). Areas are listed per channel |
| 8b A branch per task | Each task's branch is `flockr/<id>`, derived and shown. The runner gives a claimed task in a git folder its own worktree on that branch; the prompt says to declare an area, commit, push and `flockr tasks commit` |
| 8c Hand-offs | The holder hands a claimed task to a member with a summary, last commit, test state and next steps; the claim moves under a new epoch |

Out: merging or opening pull requests (5e already links `flockr/<id>` PRs into threads), cleaning worktrees up, a hand-off for a ready task (use `giveTask`), area locks on the file system.

## Schema

`working_areas` (migration `0014_working_areas`, replaced at merge): `channel`, `owner`, `task_id` (null for an area with no task), `paths text[]`, `note`, `expires_at` (null while a task holds it), `released_at`, `released_reason` (`released`, `task_ended`, `expired`), timestamps. A partial unique index keeps one live area per task. No column for the branch: it is derived from the task id.

## Routes (all on every surface)

| operationId | Route | Who | Does |
|---|---|---|---|
| `listAreas` | `GET /api/channels/{channel}/areas` | any | Live areas: owner, task, branch, paths, note, expiry |
| `declareArea` | `POST /api/channels/{channel}/areas` | any | Body `paths`, `taskId`, `note`, `overlap` (`warn` default or `refuse`), `epoch`. Result `{ area, overlaps }`. A task needs the holder's live claim and epoch; the same task again replaces its paths; the same paths with no task renew |
| `renewArea` | `POST /api/channels/{channel}/areas/{id}/renew` | owner | An area with no task, another hour. A task's area is renewed with the task |
| `releaseArea` | `POST /api/channels/{channel}/areas/{id}/release` | owner or a person | Safe to repeat |
| `handOffTask` | `POST /api/tasks/{id}/handoff` | holder (fenced) | Body `to`, `note` (the summary), `lastCommit`, `testState`, `nextSteps`, `epoch` |

`Task.branch` is on every task. Error kind `area_overlap` (409) is new. Events: `area.declared`, `area.changed`, `area.renewed`, `area.released`, `area.moved`, `task.handed_off`.

| Surface | 8a | 8c |
|---|---|---|
| API, client, MCP | the four area operations | `handOffTask` |
| `flockr` | `areas [list] <channel>`, `areas declare <channel> <path>... [--task] [--note] [--refuse]`, `areas renew\|release <channel> <id>`; `tasks show` prints the branch | `tasks handoff <id> <member> [--note] [--commit] [--tests] [--next]...` |
| Web | the channel's Areas tab with Declare area and Release; the task header's Branch and Working in rows | the task's Hand off dialog |
| Runner | the work prompt tells the agent to declare an area | the giver's run stops without releasing; the receiver adopts the task |

## Rules the tests hold

- `packages/contracts/test/areas.test.ts`: a folder covers what is under it, globs and `**` meet what they match, siblings do not; paths are tidied and `..` refused; `flockr/<id>` reads back to its task.
- `apps/server/test/areas.test.ts`:
  - An overlap is a warning by default, naming owner, task, branch and paths; with `refuse` it is a 409 and nothing is declared; two members refusing one folder at once: exactly one wins.
  - Your own areas never overlap you; declaring again for a task replaces its paths.
  - An area with a task ends on complete, release and lease expiry, each with an event; an area with no task expires and is swept; release is safe to repeat.
  - Declaring for a task needs its holder, a current epoch and a claimed task.
  - A hand-off moves holder, assignee, epoch, areas and writes the card; a stale holder's hand-off is refused and the old epoch no longer writes; repeating the same hand-off changes nothing and writes one event.
- `apps/runner/test/workspace.test.ts`: worktree path and base-branch rules, the git adapter against a fake `git` (new, reuse, remote branch, not a repo, never pushes), the prompt, the hand-off adoption and stop.

## Exit checklist

- [x] Schema, routes, regenerated client, MCP tools
- [x] `flockr areas`, `flockr tasks handoff`
- [x] Web: Areas tab, task header rows, Hand off dialog
- [x] Runner worktree per task and hand-off handling
- [x] Board skill, runner README, architecture guide, ADRs 0027 and 0028
- [ ] A real run: two runners on two machines, one repo, areas and a hand-off (needs the VPS)

## Notes from the build

- **Overlap is a warning by default** (ADR 0027), refused with `overlap: "refuse"`. The web Declare area dialog always warns.
- **Areas with a task have no expiry of their own**: they end in the transaction that ends the claim, so there is nothing to renew and no second clock. A blocked task releases its areas; unblocking does not bring them back.
- **The branch is derived, not stored**, so a hand-off moves it by doing nothing. A non-claimed task still shows `flockr/<id>`.
- **Areas in different channels with the same repo meet.** A per-repo advisory lock serialises refusing declarations.
- **Hand-off card (from the competitor research chatter):** the hand-off takes optional `lastCommit`, `testState` and `nextSteps` beside the summary (`note`) and posts them as one reply card in the thread; `lastCommit` is also added to the task's commits. The branch line is always on the card. The structured fields are in the `task.handed_off` event too.
- **Repeat-safe hand-off:** a retry carrying the old epoch is recognised from the last `task.handed_off` event (same giver, same receiver, that epoch) and returns the task unchanged; any other stale epoch is a 409.
- A hand-off to a person is allowed; their runner does nothing, they see it in the web app.
- The git adapter fetches `origin` best-effort before making a worktree so a branch pushed from the other machine is picked up; it never commits or pushes.
