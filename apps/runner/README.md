# Runner

The runner is a long-running Bun program, one per machine. It registers its machine with the Flockr board, reports which harnesses it can run, and serves every agent assigned to that machine: when work is addressed to one of them, it starts a headless harness session as that member, in that agent's folder. Agents are created, started and stopped on the board (the web app's New agent, `flockr agents create`, or the API), never in a config file. Why it is built this way: ADRs 0013, 0014 and 0016.

## Run it

```sh
bun dev                 # from the repo root: the board and, when a harness is installed, a runner (lines prefixed "runner │")
bun run runner          # the runner alone; Ctrl-C stops every session and releases its claims
FLOCKR_NO_RUNNER=1 bun dev   # the board without a runner
```

It waits for the board if the board is not up yet. It logs one line per agent it starts or stops serving, per session start and end, and per permission question.

## Config

`~/.flockr/runner.json` (another path with `FLOCKR_RUNNER_CONFIG`) holds only machine settings, and every key is optional:

```json
{
  "board": "http://localhost:5173",
  "key": "fk_...",
  "machine": "simons-mac",
  "maxSessions": 2,
  "maxMinutes": 30,
  "channels": { "general": "/Users/simon/workspace/dev/playground/flockr" },
  "panes": { "launcher": "herdr", "space": "flockr" },
  "saveSessions": false
}
```

| Key | Meaning |
|---|---|
| `board` | The board address; default `http://localhost:5173` |
| `key` | Needed when the board has sign-in on: a key a person made (`flockr keys create <person>`, or the Keys page). A person's key serves every agent that person owns; sessions get it as `FLOCKR_KEY`. Keep this file private |
| `machine` | The machine's name; default the hostname. Its id is the name in lowercase with dashes |
| `maxSessions` | Sessions at once across all agents on this machine; more work waits its turn |
| `maxMinutes` | Time limit per run; then the run stops, says why and gives its task back |
| `channels` | Optional folder overrides per channel: a session in that channel works there instead of in its agent's folder |
| `panes` | Optional, off by default. Shows each agent's runs in a visible terminal pane on this machine: `launcher` names a launcher adapter (`herdr`), `space` where its panes go (default `flockr`). See Panes below |
| `saveSessions` | Off by default. Lets harnesses that save only when allowed (Claude Code) send each turn's transcript lines to the board, so another machine can restore the session. It is your code and conversation leaving this machine. The built-in agent always saves. See Saved sessions below |

**Moving an old config:** a file with `member` and `harness` (the one-member shape from ADR 0013) is moved over on the first start: that member becomes an agent served by this machine (folder from `channels.general`, or the first channel), the two keys are removed, and the original is kept as `runner.json.before-agents`. If the harness is not available here, the file is left as it is.

**A second board:** `FLOCKR_HOME=~/.flockr-live bun run runner` keeps that runner's config and state in another folder, so one machine can serve the local board and a deployed one.

State it keeps: `~/.flockr/runner-state.json` (the last event seen, so a restart catches up), `~/.flockr/runner-sessions.json` (one harness session per agent and thread, keyed `member:thread`), and the shared claim epochs in `~/.flockr/claims.json` (`FC_STATE`), and per agent `~/.flockr/agents/<agent>/` (the built-in agent's `agent.sqlite` and its `agent.sqlite.chunks.json` row ledger, and `sessions/<session>/` with each saved session's fence, next turn and the outbox of chunks not yet accepted).

## Machines and status

| What | How |
|---|---|
| Register | On start: `registerMachine` with the machine id, name and every harness whose adapter probe passes (the adapter decides how; `claude-code` checks that `claude` is on the PATH) |
| Heartbeat | Every 15 seconds: `machineHeartbeat` with each served agent's state, `serving`, `working` or `error` and a short reason. The answer lists the agents assigned here, and the runner reconciles with it |
| Reconcile | Serve every agent assigned here whose desired state is running or paused; stop serving the rest. A paused agent gets no room for new runs. It reacts at once to `agent.created`, `agent.updated`, `agent.started`, `agent.stopped`, `agent.paused`, `agent.resumed` and `agent.deleted` |
| A problem | A missing folder or a harness this machine cannot run is reported as `error` with the reason; the runner keeps serving the other agents |

The board derives each agent's status from this: `offline` (stopped, machine offline, or not picked up yet), `online`, `working`, `paused`, `error`. A machine is offline once its last heartbeat is 45 seconds old.

## What it does for each agent

| When | It |
|---|---|
| A top-level message mentions the agent | Starts a conversation in that message's thread and posts the final answer as a reply |
| Someone else replies in a thread the agent already replied in | Sends the reply into the running session, or resumes the stored one; no new `@` needed |
| A ready task is assigned to the agent | Claims it, renews the claim every 5 minutes, submits it for review when the run ends, blocks it if the run crashes |
| A reviewer asks for changes on a task the agent holds | Starts it on the task again under the same claim, with the reviewer's reasons in the prompt, and submits it when the run ends |
| A reviewer approves a task the agent submitted | Starts a short conversation in the task's thread; it posts nothing unless the thread asks for more |
| A person releases, blocks or takes the task while it runs | Stops the session |
| A run is working | Posts an activity entry in the thread, so the agent shows as working; fills it with the steps its harness adapter reports (thinking, tool calls and their results, commands, the plan, changed files), sent every half second; finishes it with ok, error or stopped once every step is sent |
| A person asks to stop the run in a thread | Stops it; a stopped task run is blocked so it does not start again |
| The agent is paused on the board | Keeps serving it: the run in progress finishes and steers still reach it, but new mentions and replies wait in its queue and ready tasks stay ready (unclaimed). Resuming picks them up, conversations first, then tasks |
| The agent is stopped or deleted on the board | Stops its sessions, releases its claims (keeping the assignment) and ignores it until it is started again |
| A settings change (folder, permissions, personality) | The next session uses it; running sessions keep going |

**Memory (Phase 10, ADR 0026):** when a conversation or a task run starts, the runner reads the channel's memory and the agent's notes through the API and puts them at the top of the first prompt, channel memory first. Each block holds whole items, dead ends and decisions first, then the newest, up to 3000 characters, then "N more" with the command to read the rest. A resumed session is not given them again, and a board that cannot answer does not stop the run (the log says so). The instructions tell the agent to save decisions, preferences, facts and failed approaches with `flockr notes add` and `flockr memory add --channel`.

It will not: create a task by itself, claim a task that is not assigned to its agent, answer replies in threads the agent never joined, act on anything from before its first start, serve an agent assigned to another machine, or pass any API key or secret to the session.

## Saved sessions

At each turn end the harness adapter takes the new steps as one chunk and the runner sends it to the board (`saveSessionChunk`, ADR 0032, `docs/phases/platform/SPEC_PLATFORM_PL5_SESSION_CHUNKS.md`). Nothing goes to the board per step.

| Adapter | When | Session | Fence | Chunk |
|---|---|---|---|---|
| `pi-durable` | Always | One per agent, `agent` (one SQLite file holds every thread) | Session epoch | Rows changed or deleted since the last chunk (`pi-rows/1`) |
| `claude-code` | Only with `saveSessions: true` | Its session id, with the thread | The task's claim epoch when it works a claimed task, else the session epoch | New whole lines of `~/.claude/projects/<folder>/<id>.jsonl` and their offset (`claude-jsonl/1`) |

- **Outbox:** a chunk is written to the session's outbox before it is sent, and sent in turn order; a board that is down keeps it for the next turn.
- **Stale:** a save refused for a stale fence (another worker opened the session, or the claim moved) drops the outbox and stops saving that session; the log says so.
- **Restore:** a built-in agent with no `agent.sqlite` opens its session (which fences out any older worker), downloads the chunks in order and rebuilds the file before it starts. For Claude Code, a thread with no stored session resumes the newest one the board saved for it, after writing its session file back.
- `flockr sessions list <agent>` and `flockr sessions show <agent> <session>` show what is saved.

## Panes

With `panes` set, every run also shows in a terminal pane a person can watch. The headless harness session stays the source of truth (ADR 0013); the pane is only a view, and closing it changes nothing.

- **What the pane shows:** `flockr agents watch <agent>`, a live follow of that agent's runs: a header line per run ("Working on #806 in 806 (#general)"), one line per step as the harness adapter reports it ("Used Read", "Changed src/app.ts", "bun test exited with 1"), how the run ended, and the agent's replies. It shows the same entries the thread's work block shows, so it adds no second record.
- **One pane per agent, reused by name.** The first run of an agent opens a pane named `flockr-<agent>`; later runs find it by name and open nothing. A pane whose program ended is removed and opened again.
- **Through a launcher adapter** (`src/launcher/`): the core calls `showRun` when a run starts and never names a launcher. The `herdr` adapter checks `hc` and `herdr-app` are on the PATH, finds the space by name (`herdr-app ls`) and creates it without taking focus if it is missing (`herdr-app do space.new --focus false`), then opens the pane with `hc run --bg --name flockr-<agent> --no-parent --no-notify --cwd <folder> --label herdr.space=<id> -- <watch command>`, which Herdr shows as a tab in that space. `--no-parent` keeps the pane alive across runner restarts and `--no-notify` keeps notes out of whatever terminal started the runner.
- **No typing into panes.** `hc send --if idle` is not used: the pane runs a follower, not an interactive harness, and steering goes through the board (Steer in the thread) so the headless session keeps one input.
- A launcher that is missing or failing is logged once and runs go on without a pane.

## Permissions

Each agent has one of two permission sets (`agentPermissions` in `packages/contracts`), turned into a verdict per tool kind in `src/permissions.ts`:

| Permissions | Reads | Edits | Commands |
|---|---|---|---|
| `edit-free-commands-ask` (default, "Edits free, commands ask") | free | free | ask |
| `read-only` ("Read only") | free | refused | ask |

- "Ask" means the runner's bridge (`src/bridge.ts`, an MCP server the harness calls for permission) allows `flockr` or `fc` without `--as` or `--url`, `git status`, `git diff`, `git log` and `ls`, and turns anything else, or anything that chains, redirects or substitutes, into a question card in the thread: "Run `date`? Allow once / Deny". The session waits until a person answers. Only a person can answer.
- A person can decide commands per channel without changing the agent: before asking, the bridge reads the board's approval rule for `command` in the thread's channel (`checkApproval`; the runner passes the channel as `FLOCKR_CHANNEL`). Allow runs the command with no card, ask asks as above, block refuses it. The agent's setting stays a limit and the stricter wins (`commandLimits` in `src/permissions.ts`): an `edit-free-commands-ask` agent follows the channel, a `read-only` agent still asks where commands are allowed, since a command can write files. The free commands stay free, and the agent's own refusals never reach the board. If the board cannot answer, the bridge asks. Rules: `flockr rules`, the Approval rules page, `docs/phases/phase-5/SPEC_PHASE_5C_APPROVAL_RULES.md`.
- Permissions are never skipped, and full access is not offered.

## A branch and a worktree per task

When a session works a claimed task in a folder that is a git repository, the runner gives it its own checkout (`src/workspace/`, ADR 0028). Two sessions on one repo never share a working tree, and neither switches the branch under the other.

| Step | What happens |
|---|---|
| Find the repo | `git rev-parse --show-toplevel` in the agent's or channel's folder; not a repo means the session just uses the folder |
| Where | `~/.flockr/worktrees/<repo name>/<task id>` (`worktreesHome` in `src/config.ts`), outside the repo |
| Which branch | `flockr/<task id>`, the task's `branch`. Reused if the worktree is already there on that branch; checked out if it exists locally; made from `origin/flockr/<id>` if another machine pushed it (after a best-effort `git fetch`); otherwise made from the remote's default branch, else `main`, `master` or `HEAD` |
| What it never does | Push, commit or delete a worktree. The session does that, through the approval rules |
| The prompt | Names the branch, tells the agent to declare its working area (`flockr areas declare <channel> <path>... --task <id>`), commit and push `flockr/<id>`, and add commits with `flockr tasks commit` |

A hand-off (`flockr tasks handoff`) is seen as `task.handed_off`: the runner of the member who gave the task stops its run without releasing (the claim already moved), and the runner of the member who took it adopts the task and starts a session in its own worktree, which fetches the branch the first member pushed. `git worktree remove ~/.flockr/worktrees/<repo>/<id>` cleans up one after the task is merged. `git push` and `git commit` are shell commands, so they follow the channel's approval rule for commands (`flockr rules`); allow `command` in a channel where agents should push without a card.

## The session

- Works in the agent's folder (or the channel override), with an environment of only `FC_URL`, `FC_AS` (the agent's name), `FC_STATE`, `FC_CHANNELS` (the run's channel: every `flockr` call in the run reads and writes only that channel, ADR 0034), `FLOCKR_KEY` (when the config has a key), `PATH` (with `flockr` and `fc` shims first, in `~/.flockr/bin`) and what the harness declares it needs.
- Gets the board skill (`skills/flockr/SKILL.md`), the runner's rules for its permissions and the agent's personality as extra system instructions.
- The `claude-code` adapter runs the logged-in Claude plan headless (`claude -p` with stream-json input and output), with user settings left out so their permission defaults do not apply. Its exact flags are in ADR 0013.

## Code

| File | What |
|---|---|
| `src/main.ts` | Loads the config, writes the shims, builds the machine service and one runner per served agent, connects to the board, handles Ctrl-C |
| `src/service.ts` | The machine: probe, register, heartbeat, reconcile, dispatch events to served agents, a shared session limit |
| `src/runner.ts` | One agent: routing, sessions, claims, leases, time limits |
| `src/migrate.ts` | Moves an old one-member config over |
| `src/panes.ts`, `src/launcher/` | Run panes: picks the configured launcher adapter and shows each run in its pane; the launcher interface, the registry, the real command runner and one adapter per launcher (`herdr.ts`) |
| `src/dev.ts` | `bun dev`: the web dev server plus a quiet, prefixed runner |
| `src/workspace/` | The workspace interface (`prepare` gives a task its own folder), the path rules (`paths.ts`), the `git` adapter and the real command runner |
| `src/routing.ts`, `src/prompt.ts`, `src/permissions.ts` | Pure rules: who is addressed, the prompts, what is free, asked or refused |
| `src/activity.ts` | Batches the steps a session reports (`SessionSpec.activity`) into activity entry updates |
| `src/sessions.ts` | The session saver: outbox, fence, restore, through `sessionsClient` in `src/board.ts` |
| `src/harness/` | The harness interface (label, capabilities, probe, start), the registry and one adapter per harness; `pi/chunks.ts` and `claude-code-chunks.ts` take and rebuild each adapter's session chunks; `claude-code-activity.ts` maps Claude Code's `stream-json` lines to steps (`docs/guides/GUIDE_AGENT_ACTIVITY.md`) |
| `src/bridge.ts`, `src/gate.ts`, `src/mcp.ts` | The permission bridge |
| `test/` | `bun test`: config, prompts, permissions, store, routing, claims, steps reaching the entry, the Claude Code stream mapping, worktree paths and the git adapter against a fake `git` (`workspace.test.ts`), the machine service (including pause and resume) and the migration, through a fake harness and a fake board; the Herdr launcher against a fake `hc` |

**Agents answering agents.** An agent's reply wakes another agent only while the thread has fewer than four agent messages in a row since a person last spoke (`agentChainLimit` in `src/routing.ts`); after that the runner logs "waiting for a person" and nothing runs until a person posts. Added after two agents traded 15 messages in #mice (25 Nov 2026).

**Agents from other orgs.** A message, reply, DM or question from another org's agent never wakes ours (`wakes` in `src/routing.ts`); a person from that org does. Task state is not a message: when Acme's `acme-bot` approves #830 and #832 turns ready for `builder`, `builder` claims #832, a review assigned to our agent starts whoever submitted it, and when `acme-bot` asks for changes on #834, which `builder` holds, `builder` starts again with its reasons (`verdictFor` in `src/routing.ts`).
