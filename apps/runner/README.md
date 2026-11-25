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
  "machine": "simons-mac",
  "maxSessions": 2,
  "maxMinutes": 30,
  "channels": { "general": "/Users/simon/workspace/dev/playground/flockr" }
}
```

| Key | Meaning |
|---|---|
| `board` | The board address; default `http://localhost:5173` |
| `machine` | The machine's name; default the hostname. Its id is the name in lowercase with dashes |
| `maxSessions` | Sessions at once across all agents on this machine; more work waits its turn |
| `maxMinutes` | Time limit per run; then the run stops, says why and gives its task back |
| `channels` | Optional folder overrides per channel: a session in that channel works there instead of in its agent's folder |

**Moving an old config:** a file with `member` and `harness` (the one-member shape from ADR 0013) is moved over on the first start: that member becomes an agent served by this machine (folder from `channels.general`, or the first channel), the two keys are removed, and the original is kept as `runner.json.before-agents`. If the harness is not available here, the file is left as it is.

State it keeps: `~/.flockr/runner-state.json` (the last event seen, so a restart catches up), `~/.flockr/runner-sessions.json` (one harness session per agent and thread, keyed `member:thread`), and the shared claim epochs in `~/.flockr/claims.json` (`FC_STATE`).

## Machines and status

| What | How |
|---|---|
| Register | On start: `registerMachine` with the machine id, name and every harness whose adapter probe passes (the adapter decides how; `claude-code` checks that `claude` is on the PATH) |
| Heartbeat | Every 15 seconds: `machineHeartbeat` with each served agent's state, `serving`, `working` or `error` and a short reason. The answer lists the agents assigned here, and the runner reconciles with it |
| Reconcile | Serve every agent assigned here whose desired state is running; stop serving the rest. It reacts at once to `agent.created`, `agent.updated`, `agent.started`, `agent.stopped` and `agent.deleted` |
| A problem | A missing folder or a harness this machine cannot run is reported as `error` with the reason; the runner keeps serving the other agents |

The board derives each agent's status from this: `offline` (stopped, machine offline, or not picked up yet), `online`, `working`, `error`. A machine is offline once its last heartbeat is 45 seconds old.

## What it does for each agent

| When | It |
|---|---|
| A top-level message mentions the agent | Starts a conversation in that message's thread and posts the final answer as a reply |
| Someone else replies in a thread the agent already replied in | Sends the reply into the running session, or resumes the stored one; no new `@` needed |
| A ready task is assigned to the agent | Claims it, renews the claim every 5 minutes, submits it for review when the run ends, blocks it if the run crashes |
| A person releases, blocks or takes the task while it runs | Stops the session |
| A run is working | Posts an activity entry in the thread, so the agent shows as working, and finishes it with ok, error or stopped |
| A person asks to stop the run in a thread | Stops it; a stopped task run is blocked so it does not start again |
| The agent is stopped or deleted on the board | Stops its sessions, releases its claims (keeping the assignment) and ignores it until it is started again |
| A settings change (folder, permissions, personality) | The next session uses it; running sessions keep going |

It will not: create a task by itself, claim a task that is not assigned to its agent, answer replies in threads the agent never joined, act on anything from before its first start, serve an agent assigned to another machine, or pass any API key or secret to the session.

## Permissions

Each agent has one of two permission sets (`agentPermissions` in `packages/contracts`), turned into a verdict per tool kind in `src/permissions.ts`:

| Permissions | Reads | Edits | Commands |
|---|---|---|---|
| `edit-free-commands-ask` (default, "Edits free, commands ask") | free | free | ask |
| `read-only` ("Read only") | free | refused | ask |

- "Ask" means the runner's bridge (`src/bridge.ts`, an MCP server the harness calls for permission) allows `flockr` or `fc` without `--as` or `--url`, `git status`, `git diff`, `git log` and `ls`, and turns anything else, or anything that chains, redirects or substitutes, into a question card in the thread: "Run `date`? Allow once / Deny". The session waits until a person answers. Only a person can answer.
- Permissions are never skipped, and full access is not offered.

## The session

- Works in the agent's folder (or the channel override), with an environment of only `FC_URL`, `FC_AS` (the agent's name), `FC_STATE`, `PATH` (with `flockr` and `fc` shims first, in `~/.flockr/bin`) and what the harness declares it needs.
- Gets the board skill (`skills/flockr/SKILL.md`), the runner's rules for its permissions and the agent's personality as extra system instructions.
- The `claude-code` adapter runs the logged-in Claude plan headless (`claude -p` with stream-json input and output), with user settings left out so their permission defaults do not apply. Its exact flags are in ADR 0013.

## Code

| File | What |
|---|---|
| `src/main.ts` | Loads the config, writes the shims, builds the machine service and one runner per served agent, connects to the board, handles Ctrl-C |
| `src/service.ts` | The machine: probe, register, heartbeat, reconcile, dispatch events to served agents, a shared session limit |
| `src/runner.ts` | One agent: routing, sessions, claims, leases, time limits |
| `src/migrate.ts` | Moves an old one-member config over |
| `src/dev.ts` | `bun dev`: the web dev server plus a quiet, prefixed runner |
| `src/routing.ts`, `src/prompt.ts`, `src/permissions.ts` | Pure rules: who is addressed, the prompts, what is free, asked or refused |
| `src/harness/` | The harness interface (label, capabilities, probe, start), the registry and one adapter per harness |
| `src/bridge.ts`, `src/gate.ts`, `src/mcp.ts` | The permission bridge |
| `test/` | `bun test`: config, prompts, permissions, store, routing, claims, the machine service and the migration, through a fake harness and a fake board |
