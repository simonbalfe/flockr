# Master checklist

Every phase and sub-phase with its status: "where are we". Phases are product features; testing, ops and infrastructure work is the [Platform track](platform/README.md). The design every phase builds: [GUIDE_ARCHITECTURE_MODEL](../guides/GUIDE_ARCHITECTURE_MODEL.md). Competitor features, by id: [SPEC_COMPETITOR_PARITY](SPEC_COMPETITOR_PARITY.md). A sub-phase's **Covers** column names the parity rows it builds; when it ships, those rows are marked `Done (<sub-phase>)`.

**Status values:** `Not started` · `In progress` · `Blocked` · `Done (Work: <slug>)`.

**Speed first.** Commit to `main` and push; a push deploys. `pnpm check` is the only gate. Each sub-phase gets a short spec, gets built, passes `pnpm check`, and moves on. No heavy check is added unless Simon asks.

**Example tasks.** The "done when" tests use one made-up chain until real work moves onto the board:

1. #806 "Design the users table"
2. #808 "Run the users migration on prod" (needs #806; asks a person before running)
3. #812 "Build the /users API" (needs #808)

## Phases

| Phase | Done when | Status |
|---|---|---|
| **Phase 1: Headless core** | two agents work the example chain through `flockr`, each task starting by itself when the one before completes, with no person passing messages | Not started |
| **Phase 2: Slack-style web app** | on a phone, Simon watches the chain move live, answers the migration question card, and approves #812 from the review lane | Not started |
| **Phase 3: Any agent connects** | an agent on another machine, with its own key and only the MCP server, claims and completes an example task, and its commit shows on the task | Not started |
| **Phase 4: Launchers** | a task turning ready opens a Herdr pane with its agent by itself, and another runs in a cloud container with the laptop shut | Not started |
| **Phase 5: Watchers, routines and sync** | a reply in a Slack thread unblocks an example task, and a daily summary of open tasks posts by itself; both are off until someone turns them on | Not started |
| **Phase 6: Reports and search** | one query lists every blocked task across all boards, and search finds a message by its text | Not started |

## Now and Blocked

| State | Sub-phases | Detail |
|---|---|---|
| Decide before 1d | Sign-in for people | Email code (reuse flarebot's `src/worker/auth.ts`) or an OIDC proxy in front of the web app |
| Now | PL1 Live signals | Platform track (`docs/phases/platform/README.md`): Flockr moves to Cloudflare through platform adapters (ADRs 0017, 0018) |
| Decide before 4d | Coding agents | ADR 0019 is proposed: Claude Code in a disposable sandbox per task |
| Decide any time | Name and folder | Named Flockr; folder is `playground/flockr` until something ships |

## Phase 1: Headless core

Done when: two agents work the example chain through `flockr`, each task starting by itself when the one before completes, with no person passing messages.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 1a Skeleton | both | pnpm and Turborepo workspace; the Flockr server on Hono `OpenAPIHono` running on Bun; Postgres for events, tasks, people, keys and boards; Docker Compose with a local Postgres; Infisical `local` and `prod`; hosting and deploys moved to the Platform track (ADR 0017); `pnpm check`; `docker compose up` as the local board; Vitest against a real Postgres | P62, P63, P65 | Mostly built: Bun workspace (not pnpm and Turborepo, ADR 0005), Hono, Postgres through Drizzle, local Postgres in Compose, bun:test against Postgres, `bun run check`; Infisical config and running the board in Compose (PL11) left |
| 1b Event log and messages | both | Every change is an event with a sequence number; channels; post, reply, read; labels; messages never edited in place (an edit is a new event) | P1, P6, P7, P71 | Mostly built: gapless event log, channels, post, reply, read markers; left: labels on messages, edits as new events |
| 1c Tasks | agents | States waiting, ready, claimed, blocked, review, done; create; claim the oldest ready task matching labels; 15-minute lease, renewed while working, released on expiry by a timer in the server; a new fence number per claim, so a stale holder's write is refused; complete, fail, release; needs, with waiting tasks turning ready by themselves; block with a reason; assign to one agent | P16, P17, P18, P19, P20, P21, P22, P68 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 1d Keys and identity | both | People sign in (choice above); one API key per person; an agent names itself with `--as` or `BOARD_PROFILE` and shows as "claude via simon" | P34, P60 | Not started |
| 1e `flockr` command line | agents | Built on the generated client; `--json` output; post, reply, read, tasks; `flockr wait` on a thread with a timeout; `flockr tail` resuming from the last sequence number | P5, P6, P36 | Done: `flockr` (also `fc`) with `--json`, post, reply, read, tasks, `wait`, `tail` (audited 25 Nov 2026) |

## Phase 2: Slack-style web app

Done when: on a phone, Simon watches the chain move live, answers the migration question card, and approves #812 from the review lane. Pattern: `docs/reference/agent-board.html`.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 2a Shell and channels | people | React, TanStack Router and Query, shadcn/ui, served by the Flockr server; sidebar with channels, agents (working, idle or blocked dot) and people; message feed and composer; live updates over a WebSocket patching the cache, resuming from the last sequence number | P28 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 2b Thread panel | people | A task's header: state, holder, lease time left, needs, spec, commit; actions by state (claim, mark done, release, block with a reason, unblock); replies; sub-threads for review | P13, P28 | Mostly built: task header, actions by state, replies; left: commit as a link, sub-threads for review |
| 2c Tasks view | people | Columns by state, for one channel or all; expiring leases in red; waiting tasks show what they need | P28 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 2d Waiting for you | people | Question cards an agent posts and a person answers in one tap; the review lane with approve and ask for changes; a count in the sidebar | P31, P68, P73 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 2e Mentions and quick switcher | people | `@claude <text>` records the mention and starts a conversation in that message's thread, never a task (ADR 0014, superseding the earlier "creates a task" wording); tasks are made only on purpose (`flockr tasks create`, New task, Make this a task); ⌘K jumps to any channel, task or agent | P3, P24 | Done: mentions, New task, Make this a task and the ⌘K switcher (audited 25 Nov 2026) |
| 2f Phone layout and presence | people | Works at phone width with the sidebar behind a button and the thread full screen; "claude is working on #803, 11 min left" under the message box | P32 | Mostly built: sidebar behind a button, full-screen panel, presence line; left: a real phone run of the done-when flow |

## Phase 3: Any agent connects

Done when: an agent on another machine, with its own key and only the MCP server, claims and completes an example task, and its commit shows on the task.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 3a MCP server | agents | Generated from the OpenAPI document, served at `/mcp` by the Flockr server | P36 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 3b Board skill | agents | A Markdown skill for coding agents: find the channel, read the thread first, claim, reply with progress, complete with proof, ask instead of guessing | P37 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 3c Agent keys | both | Each agent gets its own key, shown with its owner and turned off alone; a key can be limited to some channels | P35, P58, P79 | Not started |
| 3d Commit links | both | A task stores the commits that did it; the thread links to each | P25 | Partial: one commit per task, shown as text; left: several commits, a repo per channel, links |
| 3e Checklist import | both | A repo's `SPEC_MASTER_CHECKLIST.md` rows become tasks with their order; completing a task ticks its row | Our own | Not started |

## Phase 4: Launchers

Done when: a task turning ready opens a Herdr pane with its agent by itself, and another runs in a cloud container with the laptop shut. The board stays agnostic: a launcher is just another client.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 4a Mac helper | both | The runner (`apps/runner`, `bun run runner`, also started by `bun dev`; ADRs 0013, 0016): one Bun program per machine that registers the machine and the harnesses it can run, heartbeats every 15 seconds and serves every agent assigned to it, starting headless harness sessions through a harness adapter (`claude-code` first). Agents are created, started, stopped, changed and deleted on the board (web New agent dialog and agent panel, `flockr agents`, `createAgent` and friends, MCP), each with its own folder, permissions and personality, and a derived status (offline, online, working, error). A mention starts a conversation in the agent's folder and later replies resume the same session; a ready task assigned to the agent is claimed, renewed every 5 minutes, submitted for review on exit and blocked on a crash; shell commands become question cards a person answers. Herdr panes (`hc run`, `hc send --if idle`) are not built | P27, P38, P43 | Runner and agents from the app built (Work: 4a-agents-from-the-app); Herdr panes not started |
| 4b Agent activity | people | Per-agent view: current task, recent steps, questions waiting; pause or stop from the web app, carried out by the launcher | P30, P72 | In progress: activity entries, live work blocks, permission cards, Steer and `stopRun` built (ADR 0015, `docs/guides/GUIDE_AGENT_ACTIVITY.md`); the agent panel shows status, machine, harness, folder, permissions and personality with Start, Stop and Delete (ADR 0016); left: the runner maps its harness stream to entries, recent steps and questions in the agent panel, pause |
| 4c Cloud agents | both | An agent created in the app can live on the machine `cloud`: it wakes on mentions and on tasks assigned to it, takes a steer mid-run, keeps its memory between conversations and runs with the laptop shut; plug-in models; adding an agent as a member of a channel (ADRs 0017, 0018; needs PL3, PL5) | P39, P40 | Not started |
| 4d Cloud coding agents | both | A coding task given to a cloud agent runs in its own sandbox: it clones the channel's repo, pushes progress to `flockr/<task>`, and opens a pull request when it submits for review; merging waits for a person (ADR 0019, proposed; needs PL6, PL7, PL8) | P25, P39 | Not started |

## Phase 5: Watchers, routines and sync

Done when: a reply in a Slack thread unblocks an example task, and a daily summary of open tasks posts by itself; both are off until someone turns them on.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 5a Watchers | both | Code that runs on each new event in a channel, as a job in a Postgres-backed queue with retries (pg-boss) | P44 | Not started |
| 5b Routines | both | Run on a schedule or an event (webhook, Slack, GitHub); off until turned on; act only on their trigger; a rate limit each and in total | P45, P46, P49 | Not started |
| 5c Approval rules | people | Per action kind: allow, ask or block, above a floor no rule can lower (spending money and prod changes always ask); an approval step a queued job waits on | P48, P53, P54, P76 | Not started |
| 5d Slack sync | people | Slack threads and board threads synced both ways; Slack tokens held by the server, never by an agent | P50, P57 | Not started |
| 5e GitHub sync | both | Pull requests and their comments come into threads | P51 | Not started |

## Phase 6: Reports and search

Done when: one query lists every blocked task across all boards, and search finds a message by its text.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 6a Event copy | people | Reports run straight on the events table in Postgres; a copy to a column store only if it gets slow | Our own | Partial: events and tasks can be paged; left: a report route |
| 6b Search | people | Find messages and tasks by text across channels | P15 | Not started |
| 6c Morning brief | people | One daily summary: what finished, what is blocked, what waits for you | P74 | Not started |

## Unplaced

Parity rows with no sub-phase yet; place one when it is wanted:

- **Messages:** P2 stream and forum channels, P4 steering a running turn, P8 reactions, P9 files, P10 scheduled posts, P11 typed message blocks, P12 comments pinned to edits, P14 channel canvas.
- **Tasks:** P23 agents handing work to each other, P26 per-agent scratchpad, P69 agents suggesting tasks, P70 two-sided sign-off.
- **People's view:** P29 watching an agent's screen, P33 voice.
- **Agents:** P41 memory, P42 role templates, P47 routines from plain language, P75 shared channel memory, P77 read-only background mode, P78 autonomy level per agent.
- **Approvals and security:** P55 approval level per agent, P56 auto-review, P59 signed events.
- **Sync and hosting:** P52 Linear, P67 many workspaces on one host.

Not planned, with the reason: P61 nothing to deploy (we run our own server on purpose), P64 self-hosting by others (our own VPS first; Docker Compose keeps it possible later), P66 live code sync (git stays the checkpoint).
