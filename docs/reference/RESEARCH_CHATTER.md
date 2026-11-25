# Research: Chatter (marcvermeeren/chatter)

Added to the competitor list as `CT` in `docs/phases/SPEC_COMPETITOR_PARITY.md` (rows P80 to P86 are new; CT is added to P3, P20, P22, P23, P25, P36, P38, P62, P74).

## What it is

A plugin for Herdr (the terminal app that runs agents in panes). It gives coding agents that work in the same Git repository on one computer a shared group chat, a small task list, hand-offs and shared notes. Claude Code, Codex and Pi can message each other, and the person joins the same chat. The author calls it "an experiment in cross-harness agent collaboration" (README). There is no server: state is one SQLite file per repository on the local disk.

| Fact | Value | Source |
|---|---|---|
| Licence | MIT | `LICENSE`, GitHub API |
| Stack | TypeScript, Node 22.5+ (built-in `node:sqlite`), zero runtime dependencies; Bun only for contributors | `package.json` |
| Size | About 3,450 lines in `src/` | `wc -l src/*.ts` |
| Maturity | Created 2026-08-16, last push 2026-08-18, 66 commits, 7 stars, 0 forks, 0 issues, version 0.19.0 | GitHub API, `package.json` |
| Platforms | macOS and Linux, needs Herdr 0.8+ | `herdr-plugin.toml` |
| Protocols | None open: no MCP, no A2A, no HTTP. Messages go into an agent's pane with `herdr agent prompt`; the `chatter` command line is the agent's way back (`--json` on most reads) | `src/team.ts` (`tryDeliver`), `README.md` |
| Claiming and locking | No leases or fencing. A task is `open`, `in_progress` or `done`; `task assign` sets the owner. SQL guards exist only for task id creation (`BEGIN IMMEDIATE`) and for claiming a message for delivery (`UPDATE ... WHERE delivered_at IS NULL`) | `src/commands.ts`, `src/team.ts`, `src/db.ts` |
| Memory | Shared notes per repository, typed note / decision / discovery / dead-end / question; superseded, not deleted; task-scoped lookup ranks dead ends first | `README.md`, `src/db.ts` (`notes`) |
| Multi-tenancy | Only per-repository isolation. "Not a security boundary"; identity is honor-system per pane | README "Trust model" |
| Hosting | Local plugin only; no hosted or networked mode | README |

## Chatter vs Flockr

| Feature | Chatter | Flockr |
|---|---|---|
| Channel chat with `@` mentions | Has: one `#chat` per repo; mention pushes into the agent | Has |
| DMs between agents and people | Has (`send`) | Partly: phase 2g |
| Threads | Missing: flat chat | Has |
| Tasks with states and claim leases | Partly: three states, assignment, no lease, no needs | Has (leases, claim) |
| Hand-off record | Has: summary, branch, commit, tests, next steps | Partly: phase 8c planned |
| Shared notes and dead ends | Has: typed, superseded | Missing: phase 10 planned |
| Open questions | Has | Missing as a separate object |
| Start a teammate agent | Has (`spawn`, worktree per agent, team wizard) | Partly: machine runners start sessions; phase 9 planned |
| Branch per agent | Has: `agents/<name>` worktree | Missing: phase 8b planned |
| Several machines or people | Missing: one computer, one person | Has: Cloudflare and Postgres |
| API, MCP, web app | Missing (terminal views only) | Has |
| Accounts, sign-in, security | Missing | Has |
| Multi-tenant workspaces | Missing | Phase 11 planned |
| Delivery waits for agent status | Has | Missing as a rule: phase 7b/8 candidate |
| Metrics from a ledger | Has (`stats`) | Missing |

## How it ties in to Flockr

### Ideas worth borrowing

| Idea | Lands in | Why |
|---|---|---|
| Note types decision, discovery, dead end, with supersede and task-scoped ordering (dead ends first) | 10a Agent notes and 10b Channel memory | A new owner of a task sees what failed before repeating it |
| Structured hand-off record (summary, branch, commit, files, tests, next steps) plus a short pointer in the thread | 8c Hand-offs | Ready-made field list; the receiver gets code through Git, as in 8b |
| Deliver by agent status: send when idle, working or done, queue when blocked, flush on a status change | 7b Parallel threads and the runner | Avoids typing into a blocked or dialog-stuck session |
| Open questions that stay open until answered | 2g (Threads view) or 8c | A question is a thread with an "unanswered" flag |
| Spawn with a purpose message and a roster plan (`/team`) | 9 Agents on demand | One command: worktree, label, announce, deliver purpose |
| `brief` and `stats` from an append-only event log | After 2g; a later phase | Cheap catch-up view and a way to measure delivery time |

### What Flockr already does better

- Works across machines and people, with accounts, an API, MCP and a web app. Chatter is one person on one machine.
- Threads and tasks as one object with claim leases. Chatter has flat chat and a three-state list with no expiry.
- A real security model. Chatter states that agent-to-agent text is "deliberate prompt injection" among trusted agents and that identity is honor-system.
- Cloudflare and Postgres hosting with a path to multi-tenant (phase 11).

### Dependency, integration or inspiration

Inspiration only.

- It cannot be a dependency: it is a local Herdr plugin with no network API, and its state is a private SQLite file ("not a public schema contract", README).
- Integration is not useful: Flockr's machine runner already starts agents through Herdr, and a second chat layer on the same panes would duplicate Flockr's channel.
- Inferred: Chatter and Flockr could run on the same Mac without clashing, but nothing in either connects them. Chatter is the closest small example of "agents in different harnesses share notes and hand-offs", which is the design space of phases 8 and 10.
- Risk: a seven-star, two-day-old experiment by one author; treat the model as an idea, not a standard.

## Sources

- https://github.com/marcvermeeren/chatter: `README.md`, `package.json`, `herdr-plugin.toml`, `LICENSE`
- `src/db.ts` (schema, per-repo SQLite), `src/team.ts` (delivery, `sendMessage`, `tryDeliver`), `src/commands.ts` (tasks, handoffs, notes, spawn, stats, brief), `src/herdr.ts`
- GitHub API `repos/marcvermeeren/chatter` for stars, forks, dates; commit count from the commits API link header (read 2026-11-25)
