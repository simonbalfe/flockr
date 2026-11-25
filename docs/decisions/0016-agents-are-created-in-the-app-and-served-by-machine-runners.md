# 0016: Agents are created in the app and served by machine runners

Status: accepted, 24 Nov 2026. Builds on 0013 (the runner launches agents through harness adapters), 0014 (a mention starts a conversation) and 0009 (nothing names a harness outside its adapter). Decided by Simon in chat: "I should be able to start Claude Code instances from the app when I want to create new bots."

## Problem

Adding a bot meant joining a member with `flockr join`, then editing `~/.flockr/runner.json` and restarting a runner that could act as only that one member. People could not make a new agent from the web app, and one runner per agent does not scale past one or two bots.

## Options

| Option | Good | Cost |
|---|---|---|
| Keep one runner per agent, configured by file | Nothing to build | Config editing and a terminal per bot; the app cannot make or start one |
| The server starts agent processes itself | No runner | The server would need the Mac's files and logins and would name a harness; breaks ADR 0013 |
| Agents are board rows; one runner per machine serves every agent assigned to it | Create, start and stop from any surface; one process per machine; the board stays agnostic | Agent config, machines and status are new state the server keeps |

## Choice

- **An agent is a member plus a served definition** (`agents` table): `harness` (an id a machine reported), `folder` (absolute), `machine`, `permissions` (`edit-free-commands-ask`, the default, or `read-only`; full access is not offered), an optional `personality`, and a `desired` state, `running` or `stopped`. `createAgent` makes the member (owned by the acting person) and its definition in one transaction, desired running. Creating does not start a process: the first session starts when someone talks to it, one process per active conversation, saved by session id and resumed (ADR 0013).
- **Changes are events:** `agent.created`, `agent.updated` (with the fields that changed), `agent.started`, `agent.stopped`, `agent.deleted`, plus `member.joined` for a new name. Start and stop are safe to repeat and write nothing the second time. Delete stops the agent and sets `members.removed_at`; its messages keep their author, it drops out of member and agent lists, and it can no longer act or be mentioned. A removed agent's name can be created again, which revives the member.
- **Machines:** the runner registers its machine (`registerMachine`: an id from the hostname or config, a name, and the harnesses it can run, each with the label and capabilities its adapter declares) and sends `machineHeartbeat` every 15 seconds with each served agent's state (`serving`, `working`, or `error` with a short reason). Heartbeats are not events: the registry and last-seen time are rows in `machines`, and the reports are columns on `agents`. A heartbeat that changes a derived status, and the sweeper noticing a machine whose last heartbeat is 45 seconds old, send an `agents` frame on the live socket (like activity presence in ADR 0014), so screens refresh without bloating the log.
- **Status is derived, never stored:** `offline` (desired stopped, the machine is offline, or the runner has not picked it up yet), `online` (served and idle), `working` (a run is active), `error` (the runner reported a reason such as a missing folder or harness). An agent with no definition (one that joined by itself) shows `working` while it holds a claim and `offline` otherwise.
- **Only a person creates, starts, stops, changes or deletes an agent** (`mayManageAgent` in `packages/contracts`). An agent that joined by itself can be given a definition by its owner, which is how the old one-member config moves over.
- **The runner is one service per machine** (`apps/runner/src/service.ts`): it reads only machine-level config (board, machine name, `maxSessions` across all its agents, `maxMinutes`, and the optional per-channel folder overrides), probes each harness adapter (the adapter decides how; the first checks that its binary is on the PATH), registers, reconciles on start and on every heartbeat, and reacts at once to the `agent.*` events. Each served agent runs the existing per-member routing (mentions, thread continuity, tasks assigned to it, question cards, stop requests) as that member, with its own client, in its folder; a channel override still wins. A folder or harness problem is reported as `error` and never stops the runner. A settings change reaches the next session without restarting running ones.
- **Permissions and personality are per agent:** the permission choice is a lookup from the permissions id to a verdict per tool kind (`allow`, `ask`, `deny`); the adapter turns it into its own flags (the first adapter lists only the allowed tools as free) and the bridge applies the same rule, so `read-only` refuses edits and still asks about commands. The personality is appended to the session's system text.
- **Migration:** an old `runner.json` with `member` and `harness` is moved over on the first start: that member gets a definition on this machine (folder from `channels.general`, or the first channel), the session map is rekeyed per member, the file is rewritten without the two keys, and the original is kept as `runner.json.before-agents`.
- **`bun dev` starts a runner too** when a harness is available (`apps/runner/src/dev.ts`); `FLOCKR_NO_RUNNER=1` turns it off, its lines are prefixed `runner │` and quiet, and a runner that fails leaves the board running.

## Why

Agents become data that every surface can change (ADR 0003), while processes still run only where the files and logins are (ADR 0013). One runner per machine keeps the number of programs fixed however many bots exist, and harness availability comes from the machine, so the server never holds a list of harnesses.

## Costs

- Two new tables and a new column; the server keeps runner-reported state that can lag by up to one heartbeat (15 seconds), and a machine shows offline up to 45 seconds after its runner dies (the live push can lag a further 15 seconds, the sweeper's interval).
- No sign-in yet (ADR 0010): "only a person" means the `x-flockr-member` header names a person, so a process on the Mac could still pose as one.
- `maxSessions` is shared across the machine's agents, so one busy agent can make another wait.
- Deleting an agent leaves tasks assigned to it assigned; a person reassigns them.
- An agent's harness and machine cannot be changed after creation; delete and create it again.
- The running `bun dev` must be restarted once to load the new live frame and machine sweeper; until then heartbeat-only status changes (online, working) show on the next refetch rather than live.
