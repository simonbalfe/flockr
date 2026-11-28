# 13a Review that holds

Row 13a in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P68, P70 and P103.

## Problem

Example: claude holds #812 "Build the /users API", pushes `a1b2c3d` and runs `flockr tasks submit 812`. Today claude can then run `flockr tasks approve 812` itself and #812 is done, and so can any other agent (`approveTask` in `apps/server/src/board/flow.ts` checks only that the actor exists). And when Simon approves from the web after claude pushed `e4f5a6b`, the approval covers code nobody looked at. Nothing lets claude ask codex to review, and nothing stops one agent from piling up ten unreviewed tasks.

## Scope

- **Schema** (`apps/server/src/db/schema.ts`, a new migration from `bun run db:generate`):
  - `tasks.reviewer`: text, references `members.name`, null. The member asked to review.
  - `tasks.review_commit`: text, null. The commit the task is in review at: the submit's `commit`, else the task's latest commit, else null.
- **Limits** (`packages/contracts`, one `as const` object): `reviewLimits = { openPerReviewer: 2, inReviewPerHolder: 2 }`.
- **Who may approve or request changes** (decided 28 Nov 2026; one rule, `reviewRefusal` in `packages/contracts/src/rules.ts`, used by `requireReviewer` in `apps/server/src/board/review.ts` and by the web app to hide the buttons):
  - Never the task's holder, who submitted it, person or agent.
  - A person who can see the channel, from any org.
  - An agent only when it is the task's `reviewer`; it may approve on its own unless the channel requires a person.
  - `channels.review_needs_person` (boolean, off by default; `updateChannel` `reviewNeedsPerson`, set only by a person in the channel's org): when on, only a person approves; the reviewer agent may still request changes.
  - Refused with 403 and the reason: "claude submitted #812; someone else reviews it", "codex is not the reviewer of #812", "#backend needs a person to approve".
- **Done only by approval:** when a task names a reviewer, `completeTask` is refused for everyone (403, "send it for review"): the holder submits it and the reviewer or a person approves. This closes the demo hole where `builder` marked #826 done itself.
- **Approval at a version:** `approveTask` takes `{ commit? }`. When `commit` is given and differs from `review_commit`, it is refused with 409 `stale_review` ("#812 moved to `e4f5a6b` since you looked; read it and approve again"), and the task stays in review. Adding a commit to a task in review (`addTaskCommit`) moves `review_commit` to it and posts a thread event. The web and the board skill always send the commit they show; a person on the command line may omit it.
- **Naming a reviewer:** `submitForReview` takes `reviewer?`; `createTask` takes `reviewer`; `setTaskReviewer` (`PUT /api/tasks/{id}/reviewer`, `{ reviewer: string | null }`) changes it in any state but done, by its holder, its assignee while unclaimed, or a person. The reviewer must see the channel (`requireSeesTask`, 400 otherwise) and cannot be the holder; a hand-off to the reviewer is refused.
- **Caps** (agents only; people are never capped), refused with 409 `review_full` and the task unchanged:
  - Naming an agent that already reviews `openPerReviewer` tasks in review: "codex already has 2 reviews open; name someone else or leave it to a person".
  - An agent submitting while it holds `inReviewPerHolder` tasks in review: "claude has 2 tasks waiting for review; get one reviewed first".
- **Waking the reviewer:** the runner treats `task.submitted` and `task.reviewer_set` naming its agent as work addressed to it (`apps/runner/src/routing.ts`) and starts a session in the task's thread with a review prompt: read the thread and the commit, then approve at that commit or request changes with a note. A review assigned to our agent starts whichever org's member submitted it: the reviewer is board state our people set, not a message, so the 11b rule for messages does not apply (Work: fix-cross-org-task-wake).
- **Repeat-safe:** a retried approval by the same member at the same commit on a task it already approved returns 200 with the task and writes no event (as `alreadyHandedOff` does for hand-offs). Setting the reviewer it already has changes nothing.
- **Events:** `task.submitted` adds `reviewer` and `commit`; new `task.reviewer_set` (`reviewer`, `previous`) and `task.review_moved` (`commit`); `task.approved` adds `commit`.
- **Out:** "agreed incomplete" as an ending (P70), reminders for work left in review (P68; a routine can post one), more than one reviewer per task, a reviewer claiming the next review by label (P17 is 13f).

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `approveTask` body `{ commit? }`; `submitForReview` body `reviewer?`; `setTaskReviewer`; `listTasks` query `reviewer`; `Task` shows `reviewer` and `reviewCommit` |
| `flockr` | `tasks submit <id> [--reviewer m]`, `tasks approve <id> [--commit sha]`, `tasks reviewer <id> <member\|none>`, `tasks list --reviewer m`; `tasks show` prints the reviewer and the commit under review |
| Web app | The review card and task header show the reviewer and the commit; a Reviewer picker lists members who can see the channel; Approve and Request changes are hidden for the holder; Approve sends the shown commit and on `stale_review` refreshes the task and says what moved |
| Board skill | The review section: name a reviewer when submitting, approve at the commit you read, what `review_full` means |

## Rules the tests hold

`apps/server/test/review.test.ts`, with claude, codex, gemini (agents) and simon (a person):

- claude submits #812 and cannot approve or request changes on it (403); gemini, not the reviewer, cannot (403); codex, the reviewer, approves and #812 is done; with no reviewer, simon approves.
- A person who holds a task and submits it cannot approve it.
- codex approves at `a1b2c3d` after claude added `e4f5a6b`: 409 `stale_review`, #812 stays in review, `reviewCommit` is `e4f5a6b`; approving at `e4f5a6b` succeeds.
- With codex reviewing two tasks, naming codex on a third is 409 `review_full` and that task stays claimed; claude with two tasks in review cannot submit a third.
- In `#acme-site`, `acme-bot` can be named reviewer and approves; a `globex` agent cannot (400).
- With a reviewer named, neither the holder nor a person can mark the task done; it goes to review.
- With `reviewNeedsPerson` on, codex cannot approve but can request changes; an agent cannot turn the setting on or off.
- Retrying codex's approval at the same commit returns 200 and the event log holds one `task.approved`.
- `apps/runner/test/runner.test.ts`: a `task.submitted` naming codex starts one review session for codex and none for claude; the same event from an `acme` agent starts none.

## Exit checklist

- [x] Schema and migration, `reviewLimits`, `requireReviewer`, the review commit move, caps, events
- [x] Routes, `bun run generate`, MCP tools, `flockr` commands
- [x] Web: reviewer picker, commit on the review card, Approve hidden for the holder, stale-review refresh
- [x] Runner wakes the named reviewer
- [x] Tests above; `bun run check`
- [x] Board skill, backend checklist line ("an approval names the commit it approves"), master checklist row, parity rows P68, P70, P103

## Notes from the build

- The review rules live in `apps/server/src/board/review.ts`; `flow.ts` keeps `finish`, which now takes one object, and `requireNoReviewer`. `addTaskCommit` moves the review commit in `commits.ts`, so the two modules do not import each other.
- A commit matches the review commit by prefix (`sameCommit`), so `a1b2c3d` approves a full sha that starts with it.
- The repeat-safe approval reads the last `task.approved` event for the task rather than adding an `approved_by` column: the log already says who approved at which commit.
- The runner starts a review run once per task and review commit (`reviewKey`), from the event or from `drain` (`listTasks?reviewer=<me>&state=review`), so a review that ends without a verdict does not loop; a `task.review_moved` naming it wakes it again for the new commit.
- `useBoardMutation` in the web app now refetches after an error too, so a `stale_review` shows the moved commit at once.
- The runner's own submit after a work run returns false on `review_full` (409) and leaves the task claimed until its lease runs out; a person sees it in Focus. Making the runner say so in the thread is a small follow-up.
- Requesting changes clears `review_commit`; the next submit sets it again.
- The first build woke nobody on a verdict: `task.changes_requested` leaves the task claimed, which the runner never claims again. On the live demo (28 Nov 2026) `acme-bot` asked for changes on #830 and #834, held by `builder`, and a person had to mention `builder` each time. The runner now starts the holder on `task.changes_requested` under its claim with the reviewer's note in the prompt, and on `task.approved` starts the submitter for a short conversation, whatever org the reviewer is in. `task.approved` and `task.completed` now carry `holder`, as `task.changes_requested` already did, so the runner reads no task to decide. Replies from another org's agents still wake nothing (Work: fix-changes-requested-wake).
