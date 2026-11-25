# 5c Approval rules

Phase 5 row 5c in the [master checklist](../SPEC_MASTER_CHECKLIST.md); parity P48, P53, P54, P76. Built on the jobs queue and routines of [5b](SPEC_PHASE_5B_ROUTINES.md) ([ADR 0020](../../decisions/0020-jobs-are-postgres-rows-drained-by-the-platform-scheduler.md)) and the runner's permission bridge ([ADR 0013](../../decisions/0013-the-runner-launches-agents-through-harness-adapters.md)).

## Problem

A routine acted as soon as it was on, and an agent's shell commands always asked, whatever the channel. A person could not say "routines in #errors may post, but ask me before they create a task", "no shell commands in #reviews", or "commands in #backend are fine". And nothing guaranteed that spending money or changing prod would always reach a person.

## Scope

- **Action kinds** (`actionKinds`, `actionKindRules` in `packages/contracts/src/approvals.ts`), each with a floor (the loosest verdict any rule may set) and a default (the verdict with no rule):

| Kind | Label | Floor | Default |
|---|---|---|---|
| `post` | Post a message | allow | allow |
| `task` | Create a task | allow | allow |
| `mention` | Mention an agent | allow | allow |
| `brief` | Post the morning brief | allow | allow |
| `command` | Run a shell command | allow | ask |
| `spend` | Spend money | ask | ask |
| `prod` | Change prod | ask | ask |

  The four routine actions map to a kind through `routineActionKind` (a new routine action fails to compile until it has one). Routine kinds default to allow because a routine is already off until a person turns it on; commands default to ask, as before.
- **Rules** (`approval_rules` table, `apps/server/src/board/approvals.ts`): kind, channel (null for the whole board), verdict `allow | ask | block`, who set it. One rule per kind and scope (`UNIQUE NULLS NOT DISTINCT`). The effective verdict is the channel rule, else the board rule, else the default, then the stricter of that and the floor (`effectiveVerdict`). Setting a verdict looser than the floor is refused (400), and a row written around the API is still clamped on read. Only a person sets or clears a rule (`mayManageApprovalRules`); anyone reads. Setting the same verdict again changes nothing. Events: `approval_rule.set`, `approval_rule.cleared`.
- **Jobs wait on approval:** a routine job whose action is `ask` posts, as `flockr`, "Routine X wants to post a message. Allow it once or deny it in this thread." in the routine's channel, with a question card in its thread (Allow once / Deny, the action in the detail), records it in `job_approvals`, and moves to the new job state `waiting` (event `job.waiting`). A person's Allow once requeues it to run at once (`job.approved`); Deny skips it with "Denied by simon". `block` skips it straight away with the reason. The answer settles the job in the same transaction as the answer (`settleJobApproval`, called from `answerInThread`). An allowed job checks off, deleted and limits again when it runs.
- **Agents and the bridge:** `GET /api/approval-rules/check?kind=&channel=` returns the effective verdict. The runner passes the channel to its bridge (`FLOCKR_CHANNEL`), and the gate asks the board for `command` whenever the agent's own setting would ask about a command. The result is the stricter of the channel's verdict (allow, ask, block as refuse) and the agent's command limit (`commandLimits`: `edit-free-commands-ask` up to allow, `read-only` up to ask, since a command can write files). The free list (`flockr`, `git status`, `git diff`, `git log`, `ls`) stays free, and the agent's own refusals (a read-only agent's edits) never reach the board. If the check fails, the gate asks.
- **Surfaces:**

| Route | operationId | `flockr` | Web |
|---|---|---|---|
| `GET /api/approval-rules` | `listApprovalRules` | `rules [list] [--channel c]` | Approval rules page |
| `PUT /api/approval-rules` | `setApprovalRule` | `rules set <kind> allow\|ask\|block [--channel c]` | The Allow / Ask / Block control on a row |
| `DELETE /api/approval-rules?kind=&channel=` | `clearApprovalRule` | `rules clear <kind> [--channel c]` | Reset on a row |
| `GET /api/approval-rules/check?kind=&channel=` | `checkApproval` | `rules check <kind> [--channel c]` | Each row's verdict and where it came from |

  Every route is an MCP tool. The page sits under Routines in the sidebar: a scope picker (Whole board or a channel) and one row per kind with its source ("Default", "Set for #backend", "From the whole board"), "Always at least ask" for spend and prod, and a segmented control whose options below the floor are disabled. Answering a waiting job uses the existing question card in its thread and in Waiting for you.

**Out:** rules per tool, connector or command pattern (P54 beyond kinds); "Allow always" on a card (P53); approval steps in workflow files (P48 beyond routine jobs); a waiting job that expires; a routine action that spends money or changes prod (none exists yet: the kinds and floors are ready for one, and agents ask through the board skill).

## Rules the tests hold (`apps/server/test/approvals.test.ts`, `apps/runner/test/units.test.ts`)

- No rule makes spend or prod looser than ask, board-wide or per channel; a row inserted around the API is still clamped to ask; every default is at or above its floor.
- Only a person sets or clears a rule; a channel rule beats the board rule; clearing restores the board rule; clearing twice changes nothing.
- A waiting job runs only after Allow once, exactly once; an agent cannot answer; a second answer is refused.
- Deny skips the job with its reason and it never runs; block skips at once and asks nobody.
- The bridge follows the channel rule (allow runs, ask asks, block refuses), the stricter of rule and agent setting wins (read-only still asks where commands are allowed), free commands stay free, and the agent's own refusals never consult the board.

## Exit checklist

- [x] Migration `0011_approval_rules.sql` from `bun run db:generate`: two new tables and `waiting` added to the jobs state check.
- [x] Routes, generated client and MCP tools, `flockr rules`, the Approval rules page.
- [x] Runner bridge consults the check route; board skill, runner and web READMEs updated.
- [x] `bun run check` passes.
- [x] Checked on a running build against a test database: the page sets and resets rules and refuses Allow for spend and prod; a watcher with `post` at ask asked in #backend, Allow once in Waiting for you ran it once.

## Notes from the build

- A sixth job state, `waiting`, beside 5b's five. A waiting job has no lock and no finish time; it keeps its attempt count, which still fences a stale drainer, so an approval costs one of its five attempts.
- The approval card is an ordinary thread question asked by `flockr` under a root message, so the existing question card, inbox and `flockr answer` work unchanged; `job_approvals` links the question to its job. Its events carry `data.routine`, so watchers never fire on them.
- A channel rule beats the board rule even when looser (most specific wins, still above the floor). Decided here; reversible.
- The agent's permission setting stays the limit for commands through `commandLimits`, not through its tool verdicts: Claude Code pre-allows any tool whose verdict is allow, so the command verdict stays ask and every command still reaches the bridge.
- The sidebar's Waiting for you badge counts task questions and reviews, not thread questions (as before), so an approval card shows in the list but not in the count.
