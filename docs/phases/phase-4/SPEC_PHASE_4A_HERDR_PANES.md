# 4a Herdr panes

Row 4a in the [master checklist](../SPEC_MASTER_CHECKLIST.md), the part left after the runner and agents from the app: Phase 4 is done on the Mac side when "a task turning ready opens a Herdr pane with its agent by itself". Builds on [ADR 0013](../../decisions/0013-the-runner-launches-agents-through-harness-adapters.md) (headless harness sessions, where a Herdr pane per task was weighed and rejected as the source of truth) and [ADR 0016](../../decisions/0016-agents-are-created-in-the-app-and-served-by-machine-runners.md) (one runner per machine). How the runner works: [apps/runner/README.md](../../../apps/runner/README.md).

## Problem

The runner starts Claude Code headless, so nothing on the Mac shows what an agent is doing. Simon lives in Herdr and wants to see a run there without opening the web app.

Example: a task assigned to scout turns ready. Before, scout claimed it and worked with no window anywhere. After, with `"panes": { "launcher": "herdr" }` in `~/.flockr/runner.json`, a tab `flockr-scout` appears in the Herdr space `flockr` and prints "Working on #806", then "Used Read", "Changed src/app.ts", "bun test exited with 1", and "done: Working on #806".

## Choice

- **The pane is a view; the headless session stays the truth.** Moving the session itself into a pane would lose resume per thread and permission question cards (ADR 0013), so the pane runs `flockr agents watch <agent>`: a live follow of the agent's activity entries, its steps and its replies, the same data the thread's work block shows. No ADR: it applies 0013, and it is one adapter behind an optional setting.
- **One pane per agent, reused by name** (`flockr-<agent>`, cut to Herdr's 32 characters). Per-run panes would pile up a tab per conversation; one per agent shows its runs in order. A pane whose follower ended is removed and opened again.
- **A launcher adapter**, like harness adapters (ADR 0009): `src/launcher/types.ts` (probe, `panes({ space, run })`, `show({ key, folder, argv })` giving opened, reused or failed), `registry.ts`, `herdr.ts`, the only file naming `hc` and `herdr-app`. The runner core calls `showRun` when a run starts; `src/panes.ts` picks the configured launcher and logs the outcome once.
- **The `herdr` adapter:** `hc get <name> --json` to reuse; `herdr-app ls` to find the space by name, `herdr-app do space.new --name <space> --folder <folder> --focus false` once if it is missing; `hc run --bg --json --name <name> --no-parent --no-notify --cwd <folder> --label herdr.space=<id> --label flockr.pane=<agent> -- <bun> <cli> --url <board> agents watch <agent>`. Absolute program paths, because Herdr starts programs with a bare PATH. `--no-parent` keeps the pane across runner restarts; `--no-notify` keeps notes out of any terminal. Calls are serialized, so two runs starting at once open one pane.
- **`hc send --if idle` is not used.** The pane runs a follower, not an interactive harness, so there is nothing to type into; steering goes through the board (Steer), which keeps one input per session.

## Scope

- Runner setting `panes: { launcher, space }` (Zod in `apps/runner/src/config.ts`; `space` defaults to `flockr`); off when absent, logged and skipped when the launcher is unknown or its CLIs are missing.
- `flockr agents watch <name>`: follows the agent's runs live, catching up on a run already in progress and on a missed revision by reading the entry again.
- **Out:** closing panes when an agent is stopped or deleted (a person closes them), panes on other machines, a pane per thread, putting the interactive harness in the pane.

## Surfaces

The setting is per machine, so it lives in `runner.json`, not the API. `flockr agents watch` is a CLI view over existing routes and the live socket; the web app already shows the same steps live in the thread and the agent panel, and MCP has no streaming tools.

## Rules the tests hold

- The adapter issues the expected `hc` and `herdr-app` commands, reuses a live pane by name, removes and reopens a finished one, creates a missing space without focus, and opens one pane for two runs starting at once (`apps/runner/test/launcher.test.ts`, a fake command runner).
- Panes are off unless configured; an unknown launcher is logged, not fatal.

## Exit checklist

- [x] `panes` setting decoded with Zod; launcher adapter and registry; the core names no launcher.
- [x] A run start opens or reuses the agent's pane, which follows its steps.
- [x] `flockr agents watch`, documented in the runner README and the CLI help.
- [x] Live check: one hidden pane `flockr-test-pane` ran `zsh -lc 'echo flockr pane check'`, `hc get` showed it (finished, exit 0, no parent, labels set), `hc rm` removed it.
- [x] `bun run check` passes (server 70, runner 110, web 6).

## Notes from the build

- The live check confirmed the shapes the adapter decodes: `hc run --bg --json` returns `{ address, name, state: "live" }`, `hc get` returns `state` `live` or `finished`, and a missing name exits 3 with `{ error }`. It ran without a space label, so Simon's layout was not changed; a labelled pane in a real space was not opened.
- Not checked end to end with a real agent: that needs a real Claude Code session and the dev board, both off limits for this build. The first real run with `panes` set should be watched once.
- A created space gets Herdr's own first tab (a shell) besides the agent tabs.
- The follower reads as the CLI's default member; it only reads.
