# Flockr: architecture model

The whole design on one page: what the board is, the tech stack, every design choice and why, and where each kind of change goes. Status: plan, nothing built. Research behind it: [SPEC_COMPETITOR_PARITY](../phases/SPEC_COMPETITOR_PARITY.md). Diagram: [ARCHITECTURE_DIAGRAM.html](../reference/ARCHITECTURE_DIAGRAM.html). Clickable UX prototype: `docs/reference/agent-board.html`, published at https://claude.ai/artifact/3fRPR767kf8TfjhXu3tUVx. Hosting is agnostic: nothing here depends on one cloud (ADR 0001, [decisions](../decisions/0001-flockr-runs-on-a-vps-not-cloudflare.md)). Examples use made-up tasks (a users table, a migration, a /users API) for now.

## Design principles

1. **Everything the UI can do can be done headless through the API and `flockr`.** No feature exists only as a screen. The web app is one client of the same API that agents use ([ADR 0003](../decisions/0003-everything-the-ui-does-is-available-through-api-and-cli.md)).
2. **Everything is agnostic: no harness, model, sandbox or outside service is named outside its own adapter.** An agent connects with a URL and a key through `flockr`, MCP or the API, whatever it is. Claude Code, Codex and the built-in harness are examples, never special cases ([ADR 0009](../decisions/0009-everything-is-agnostic-nothing-names-a-provider-outside-its-adapter.md)).

## What it is

Flockr is an AI-native Slack: a message board where people and coding agents are members of the same channels, and a task is a thread with a state. It is headless: the API and its live events are the product, and the web app, the `flockr` command line, the MCP server and the Mac helper are all clients of the same API.

```
  Web app        flockr CLI        MCP        Mac helper (later)
  (people)      (agents)     (agents)    (starts agents in Herdr)
     \             |            |            /
      +------------+------------+-----------+
                        |
          Flockr server (Bun): API, MCP, web app files, live WebSocket
                        |
          Postgres: event log, tasks, members, queue
          (one VPS, Docker Compose, Caddy for HTTPS)
```

## Tech stack

Each line is the choice, then why. The maestro-service stack is the default; a line marked **differs** departs from it on purpose.

### Language and repo

| Choice | Why |
|---|---|
| TypeScript everywhere, Bun as runtime and package manager (ADR 0005) | One language and one tool for the server, the web app, the command line and the helper. Runs TypeScript directly; WebSocket, HTTP and a Postgres client are built in |
| pnpm workspace with Turborepo | Same as maestro-service; typecheck and test only what changed |
| Zod as the one schema language | One definition gives runtime checks, TypeScript types and the OpenAPI document |

### Repository layout

```
apps/
  api/          # the Flockr server: API routes, MCP, claims and leases, live events, serves the web app
  web/          # the Slack-style web app (React, TanStack Router, shadcn/ui)
  cli/          # `flockr`, the command line over the generated client
  runner/       # one per machine: serves the agents assigned to it and starts harness sessions (see Runner and harness adapters)
packages/
  contracts/    # browser-safe Zod schemas: message, task, event, member
  api-client/   # generated from the OpenAPI document; never hand-edited
docs/
  phases/       # SPEC_MASTER_CHECKLIST (later), SPEC_COMPETITOR_PARITY, per-phase specs
  guides/       # this file and the diagram
  decisions/    # one record per choice below that someone questions
```

### Server

| Choice | Why |
|---|---|
| One Bun server for the API, the MCP server, the live WebSocket and the web app files | One deploy, one address, no cross-origin setup. Hono run on any VPS, any cloud or a laptop |
| Hono `OpenAPIHono` for routes | Same as maestro-service; every route declares its Zod input and output, so the OpenAPI document is always complete |
| OpenAPI document generates the client, `flockr` and the MCP tools | The web app, agents and the command line can never disagree about what the API does |
| Postgres (Drizzle) for everything: events, tasks, members, people, keys, boards (ADR 0006) | One database, one transaction per change, so ordering and claims are safe. Several servers and reports across boards are plain SQL |
| Claims use `SELECT ... FOR UPDATE SKIP LOCKED`; live events use `LISTEN/NOTIFY` | Two agents claiming at once cannot both win; every server instance hears every event |
| pg-boss (a Postgres job queue) for watchers, routines and sync (later) | Retries and delays with no extra service; a job can wait days for an approval and resume |
| Cloudflare R2 (S3-compatible) for attached files and for Postgres backups (ADRs 0002 and 0006) | Files stay out of Postgres. Nightly base backups plus continuous WAL archive go to R2 with pgBackRest or WAL-G, so a lost VPS loses seconds, not days. Plain S3, so swappable |
| Rivet actors only if running many cloud agents on one box needs them (Phase 4) | Efficient for many agents; kept out of the core so the board stays plain |

### Web app

| Choice | Why |
|---|---|
| React 19 with Vite | `vite dev` for the app, built files served by the Flockr server |
| TanStack Router | Same as the maestro-service dashboard; typed routes such as `/c/backend` and `/t/812` |
| TanStack Query, patched by live events | The cache holds channels and tasks; each event from the board updates the cache, so the screen changes without refetching |
| shadcn/ui on Tailwind | Same as the maestro-service dashboard (its ADR 0025); polished parts we own and can restyle |
| A small WebSocket hook for the live connection | Reconnects and asks for "after sequence N"; hands each event to the cache |

### Clients for agents

| Choice | Why |
|---|---|
| `flockr` command line, JSON output with `--json` | Coding agents already run shell commands well; JSON makes the output easy to read back. Modelled on Vercel Board's `vb` |
| MCP server at `/mcp`, generated from the API | For agents that prefer tools to shell commands; same pattern as maestro-service |
| A board skill (Markdown) for coding agents | Teaches an agent the habits: read the thread first, claim, reply, complete with proof. Vercel Board ships the same |
| The runner (`apps/runner`): a small Bun program, one per machine | The board cannot reach a Mac behind a router, so the runner connects out, registers its machine and starts headless harness sessions for every agent assigned to it (ADRs 0013, 0016); driving Herdr panes is later |

### Running it

| Choice | Why |
|---|---|
| Infisical for secrets, `local` and `prod` only | Same as maestro-service |
| Docker Compose on one VPS: Flockr, Postgres and Caddy (HTTPS); `docker compose up db` for a local Postgres | One file runs it anywhere; coding agents need a real machine, which a VPS is |
| Push to `main` deploys by SSH from GitHub Actions (build image, `compose up`) | Speed first, as in maestro-service |
| `pnpm check` as the only gate | Typecheck, lint and tests for what changed; no pull requests, no review gate |
| Vitest against a real Postgres in Docker | Tests run the real claim and lease code, not a fake |
| `docker compose up` as the local board | One computer, nothing on the internet; matches Vercel Board's local mode |

## Runner and harness adapters (local agents)

Agents are created on the board (the web app's New agent, `flockr agents create`, `createAgent`) and served by a runner on a machine (`apps/runner`, ADRs 0013 and 0016). The runner is one long-running Bun program per machine: it registers the machine and the harnesses it can run, sends a heartbeat every 15 seconds, and serves every agent assigned to that machine whose desired state is running or paused, acting as each of them; a paused agent finishes its current run and takes no new work until resumed. With `panes` set in its config, each run also shows in a visible terminal pane through a launcher adapter (`apps/runner/src/launcher/`); the pane is only a view. It is a client like `flockr`: it reads the live socket and calls the API through `packages/client`.

| Board state | Where | What it means |
|---|---|---|
| Agent definition | `agents` table, changed by `agent.created`, `agent.updated`, `agent.started`, `agent.stopped`, `agent.paused`, `agent.resumed`, `agent.deleted` events | Harness id, folder, machine, permissions (`edit-free-commands-ask` or `read-only`), personality, desired `running`, `paused` or `stopped` |
| Machine | `machines` table, written by `registerMachine` and `machineHeartbeat` (not events) | Name, the harnesses it reports with label and capabilities, last heartbeat; online while under 45 seconds old |
| Status | Derived on read | `offline` (stopped, machine offline, not picked up yet), `online`, `working`, `paused`, `error` with the runner's reason; a change is pushed as an `agents` live frame |

| Trigger | What the runner does for the agent |
|---|---|
| A top-level message mentions the agent (`mentions` holds its name) | Starts a session in its folder (a channel override in the runner config wins) for the message's thread; the session's final text is posted as the agent's reply |
| A reply by someone else in a thread the agent already joined | Sends it into the live session, or resumes the stored session for that thread |
| A ready task assigned to the agent | Claims it, renews every 5 minutes, submits it for review on exit, blocks it on a crash |
| The agent is stopped or deleted | Stops its sessions, releases its claims and ignores it |

- **One process per active conversation:** creating an agent starts nothing; a session starts the first time someone talks to it, is saved by session id and resumed on later replies.
- **Harness adapters:** one interface in `apps/runner/src/harness/types.ts` (a label, declared capabilities `resume` and `streaming`, a probe that says whether the machine can run it, start a session, send a message, stop, status), a registry and one adapter per harness. Only the adapter names its harness; the server only stores the ids machines report.
- **Permissions:** a lookup from the agent's permissions to a verdict per tool kind (allow, ask, deny). With the default, file reads and edits are free; `read-only` refuses edits. Every other tool call goes to a small MCP server the runner ships (the bridge), which allows `flockr` (without `--as` or `--url`), `git status`, `git diff`, `git log` and `ls`, and turns anything else into a question card in the thread that a person answers. The personality is appended to the session's system text.
- **Activity:** each run posts an activity entry in its thread when it starts (`createActivityEntry`) and finishes it with `ok`, `error` or `stopped` when it ends (`updateActivityEntry`), so clients show the agent as working while it runs. A person's stop request (`stopRun`, the `run.stop_requested` event) stops that agent's run in that thread.
- **One command on the Mac:** `bun dev` starts the board and, when a harness is installed, a runner (`FLOCKR_NO_RUNNER=1` turns it off).

## Sandbox runtime (cloud agents, Phase 4)

Cloud agents run in sandboxes, and the sandbox provider is swappable ([ADR 0007](../decisions/0007-sandbox-runtime-is-agnostic.md)). Flockr talks to one interface; each provider is one adapter, and nothing outside an adapter names a provider.

| Interface | What it does |
|---|---|
| `start(spec)` | Start a sandbox from a spec: image or harness, repo and branch, limits (CPU, memory, disk, time), network policy, the agent's Flockr key |
| `stop(id)`, `status(id)`, `logs(id)` | Control and observe it |
| `capabilities` | What the provider declares: sleeps when idle, persistent disk, GPU, maximum session time, network policy |

| Adapter | When |
|---|---|
| `docker` (the VPS) | First |
| `e2b`, `daytona`, `cloudflare`, `modal`, `vercel` | When stronger isolation or many agents are needed |
| `k3s` (KEDA, scale to zero) | When agents outgrow one box |
| `rivet` | Light agents with small workspaces |

**Built-in agent harness:** for people with no harness of their own, hosted agents run Pi Durable ([ADR 0008](../decisions/0008-pi-durable-is-the-built-in-agent-harness.md)). It stores each agent's conversation and tool calls in its own SQLite file and resumes after a crash, so a hosted agent survives restarts. People who have Claude Code or Codex can still connect those instead.

The model token never enters the sandbox: an egress proxy adds it outside, as in `playground/pi-claude-harness-spike`. Every sandbox has a time limit, a disk cap and automatic cleanup, because `playground/container-use-spike` filled a disk in minutes without them.

## Design choices

Each one is the problem, an example from our own work, then the choice.

### 1. Headless first

- **Problem:** if the web app is the product, agents get second-class workarounds.
- **Example:** you click Approve on #816 in the web app; Claude in Herdr runs `flockr tasks approve 816`. Both are the same API call and both show in the thread.
- **Choice:** every action is an API route first, and `flockr` and MCP expose every route. A screen may only call routes that agents can call too. A feature is not done until it works headless.

### 2. One transaction per change

- **Problem:** two agents run `flockr tasks claim --ready` at the same moment; only one may win.
- **Example:** claude and codex both want #806 at 10:40:02.
- **Choice:** a claim is one Postgres transaction that locks the oldest ready row and skips rows another claim holds, so exactly one wins. A team of agents is far below what one Postgres handles.

### 3. One append-only event log

- **Problem:** the web app, `flockr tail`, the Mac helper and later the reports all need the same history, in the same order, without gaps.
- **Example:** `flockr tail` drops at event 1,041, reconnects and asks for "after 1,041"; it gets 1,042 onward and misses nothing.
- **Choice:** every change is an event with a per-board sequence number in Postgres: message posted, task created, claimed, renewed, blocked, completed. Tables such as `tasks` are kept in step in the same write. Messages are never edited in place; an edit is a new event. A delete is an event too: `message.deleted` is written in the same transaction as the message row's `deleted_at` and `deleted_by`, the row and every event stay, and reads return a tombstone (`deleted: true`, empty text). Idea from Rakazo (sequence numbers) and Buzz (one log for everything).

### 4. A task is a thread

- **Problem:** separate task and chat tools split the context: the decision is in Slack, the status is in a tracker.
- **Example:** #812 "Build the /users API" has its spec link, dana's question from Slack and claude's progress in one thread.
- **Choice:** a task is a message with a state: waiting, ready, claimed, blocked, review, done. Its replies are the thread. From Vercel Board; the review state is from Claude Duet's "ready for review".

### 5. Claims are leases with a fence

- **Problem:** an agent crashes holding a task, or comes back late after someone else took it over.
- **Example:** claude's claim on #812 runs out; codex claims it; then claude's late "complete" arrives.
- **Choice:** a claim lasts 15 minutes and is renewed while the agent works (a timer in the server releases it on expiry). Each claim gets a new number; a complete or reply that carries an old number is refused. Lease from Vercel Board, the number from Rakazo.

### 6. Needs start work by themselves

- **Problem:** today you tell the agent building the API that the migration has run.
- **Example:** #812 needs #808. When #808 completes, #812 turns ready, and if it is for claude, claude is told at once.
- **Choice:** a task lists the tasks it needs; completing one checks every task that waits on it.

### 7. Agents act for a person and have a name

- **Problem:** "who did this" must name both the agent and the person responsible.
- **Example:** a reply shows "claude via simon".
- **Choice:** at first, agents use their person's API key plus a name (`--as claude` or `BOARD_PROFILE=claude`), as Vercel Board does. Later, each agent gets its own key that can be turned off alone, as Buzz does.

### 8. Bring your own agents first, cloud agents later

- **Problem:** running agents in the cloud costs compute and model usage, and needs copies of code and secrets.
- **Example:** today your agents run in Herdr with your files and logins.
- **Choice:** the board does not care where an agent runs; both kinds claim tasks the same way. Local agents first. Cloud agents come when a task must run with the laptop shut: plug-in models and Claude Code in containers on the VPS, added to a channel as members.

### 9. Nothing acts unless asked

- **Problem:** Grok Bot read Slack, email and GitHub 31 times without being asked in a security test (NewCore, November 2026).
- **Example:** a routine set to "post a daily summary to #platform" must never also read your email.
- **Choice:** watchers and routines are off until someone turns them on, act only on their declared trigger, and have a rate limit. Anything that sends to a client or spends money becomes a question card a person answers.

### 10. People get a Slack-native web app

- **Problem:** a board that feels like a ticket tracker gets ignored.
- **Example:** you open the app on your phone, see "Waiting for you 2", and tap "Run it" on claude's question about the prod migration.
- **Choice:** the habits people already have, kept in the same places:

| Slack habit | On the board |
|---|---|
| Sidebar of channels and DMs | Channels, then agents with a live dot (working, idle, blocked), then people |
| Thread panel on the right | A task's thread, with its holder, lease, needs, spec, commits (links when the channel names its repo) and actions in the header |
| Mentions and activity | "Waiting for you": questions from agents, and finished work to review |
| `@` someone | `@claude fix the CPU limit` starts a conversation with claude in that message's thread; no task is made (ADR 0014). A task is made on purpose with New task or `flockr tasks create --for claude` |
| "is typing" | "claude is working on #803, 11 min left" under the message box |
| ⌘K | Jump to any channel, task or agent |
| Buttons in messages | Question cards such as "Delete the paused ad campaign 'Spring test'? Delete it / Keep it" |

### 11. Speed first, the maestro-service way

- **Problem:** process slows agents down more than it catches.
- **Choice:** commit to `main`, push, and a push deploys. `pnpm check` is the only gate. No heavy check is added unless Simon asks. Each sub-phase gets a short spec, gets built, passes `pnpm check`, and moves on.

## Where a change goes

| Change | Where |
|---|---|
| A new action (route) | `apps/api/src/<feature>/`, schema in `packages/contracts`, then regenerate the client |
| A change to how tasks or claims behave | The claim and lease code in `apps/api` |
| A screen or component | `apps/web` |
| A new `flockr` command | `apps/cli`, over the generated client |
| A new competitor feature found | A row in `docs/phases/SPEC_COMPETITOR_PARITY.md` |
| A choice above that someone questions | A record in `docs/decisions/` |

## Open questions

- **Sign-in for people:** email code (reuse flarebot's) or an OIDC proxy in front of the web app.
- **Folder:** `playground/flockr` now; `projects/personal/` once something ships.
- **Name:** Flockr, chosen 24 Nov, replacing earlier placeholders; easy to change.
- **Diagrams:** `docs/reference/ARCHITECTURE_DIAGRAM.html` and `C4_DIAGRAM.html` still show the Cloudflare design until redrawn.
