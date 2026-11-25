# 0027: Working areas warn on overlap by default and live as long as the task's claim

Status: accepted, 25 Nov 2026. Builds on [0019](0019-coding-agents-run-claude-code-in-a-disposable-sandbox-per-task.md) (branch `flockr/<task>`).

## Problem

An agent on a VPS and Simon on his Mac work one repo. Each must see what the other is touching before editing, and neither may overwrite the other's work. Example: claude declares `apps/server/src/board`; codex then wants `apps/server/src/board/claims.ts`.

## Options

| Option | Good | Cost |
|---|---|---|
| Always refuse an overlap | No clash can happen | Two members who agreed to share a folder are blocked; one stale area blocks everyone until it ends |
| Never block, only show | Never in the way | An agent that ignores the output still clashes |
| **Warn by default, refuse when asked** (`overlap: "refuse"`) | The agent reads the overlap and decides; a strict caller gets an atomic refusal | A careless caller can ignore the warning |

## Choice

- **Overlap is a warning by default.** Declaring returns the overlapping areas (who, which task and branch, which paths meet). `overlap: "refuse"` answers 409 `area_overlap` and declares nothing. Refusals are serialised per repo with an advisory lock, so two refusing declarations of one folder have exactly one winner.
- **An area with a task lives and dies with the claim.** It is released in the same transaction that ends the claim (complete, submit, release, fail, block, lease expiry) and moves to the new holder on a hand-off. It needs no renewing. An area with no task (a person's) has its own expiry, one hour, renewed with `renewArea` and swept by the lease sweeper.
- **One live area per task**: declaring again replaces its paths. Your own areas never overlap you.
- **Paths are folders, files or globs** (`*`, `?`, `**`) relative to the repo. A folder covers everything under it; two globs are assumed to meet. The rule is `pathsOverlap` in `packages/contracts/src/areas.ts`, shared by the server and the web app. Areas in different channels that name the same repo meet each other.
- **The branch is derived, not stored**: `flockr/<task id>` (`taskBranch`), shown on every task and area, so a hand-off moves it by changing nothing.

## Why

The goal is that members see each other, not that the board polices them. The task claim is already the source of truth for who works on what, so tying areas to it removes a second lifetime to keep right.

## Costs

- An agent that ignores a warning still clashes; the branch per task (0028) and review are the backstop.
- Glob against glob is conservative: it may warn about paths that do not really meet.
- A blocked task releases its area; unblocking does not restore it, the agent declares again.
