# 0028: The runner gives each claimed task its own git worktree on `flockr/<task>`

Status: accepted, 25 Nov 2026. Builds on [0013](0013-the-runner-launches-agents-through-harness-adapters.md), [0016](0016-agents-are-created-in-the-app-and-served-by-machine-runners.md) and [0019](0019-coding-agents-run-claude-code-in-a-disposable-sandbox-per-task.md).

## Problem

Two sessions the runner starts in one folder share a checkout: one switches branch or leaves half-edited files under the other. Example: claude on #806 and codex on #808 both in `~/workspace/dev/flockr`. Cloud sandboxes already get a branch per task (0019); local runners had nothing.

## Options

| Option | Good | Cost |
|---|---|---|
| Tell agents to make a branch | No runner code | Same working tree; one `git switch` breaks the other |
| Clone per task | Full isolation | Slow, large, no shared objects |
| **`git worktree` per task under the runner's home** | Own folder and branch, shared objects, fast, reuse on resume | Needs git; the repo's branch is locked to one worktree |

## Choice

- The runner prepares `~/.flockr/worktrees/<repo>/<task id>` on branch `flockr/<task id>` through a `Workspace` interface (`prepare`) with one adapter, `git`, in `apps/runner/src/workspace/`. The runner core only calls the interface and never names git (0009).
- Reused if present on the branch; checked out if the branch exists locally; made from `origin/flockr/<id>` when another machine pushed it; else from the default branch. A folder that is not a repository, or any git failure, falls back to the plain folder and says so in the log.
- The runner never pushes or commits. The agent's prompt tells it to commit, push `flockr/<id>`, add commits with `flockr tasks commit` and declare its working area (0026); git commands follow the channel's approval rule.
- A hand-off ends the giver's run without releasing and adopts the task on the receiver's runner, which fetches the pushed branch.

## Costs

- Worktrees pile up under `~/.flockr/worktrees` until removed by hand (`git worktree remove`); cleaning up on merge is later work.
- `git fetch` on each new worktree needs network and credentials; failure is ignored and the branch is made from local refs.
- The folder check is a repo root, so an agent whose folder is a subfolder works in the same subfolder's repo root checkout (the worktree is of the whole repo).
