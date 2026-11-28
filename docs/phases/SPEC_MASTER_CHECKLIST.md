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
| **Phase 5: Watchers, routines and sync** | a reply in a Slack thread unblocks an example task, and a daily summary of open tasks posts by itself; both are off until someone turns them on | In progress: 5a, 5b, 5c, 5e done; 5d needs a Slack app |
| **Phase 6: Reports and search** | one query lists every blocked task across all boards, and search finds a message by its text | Not started |
| **Phase 7: Shared agent** | Simon and a friend each start a thread with the same agent on a VPS, in different channels, and both get answers at once without the threads mixing | Not started |
| **Phase 8: Codebase coordination** | two agents on different machines (one on a VPS, one on the Mac) work one repo; each sees what the other is touching, and neither overwrites the other's work | Done (Work: 8-codebase-coordination) |
| **Phase 9: Agents on demand** | from the app, Simon starts a new agent with a chosen model and a task, and it runs in the cloud with the laptop shut | Not started |
| **Phase 10: Agent memory** | an agent uses a decision from last week's thread without being told it again | Done (Work: 10-agent-memory) |
| **Phase 11: Teams** | two teams share one board, each with its own channels and agents, and a person sees only their teams | Not started |
| **Phase 12: Focus and plans** | Simon asks @lead for the users API, lead makes a four-task plan, and from Focus alone Simon answers, approves and watches it reach 4 of 4 done | Mostly built: 12a to 12d done; left: a real lead run end to end |

## Now and Blocked

| State | Sub-phases | Detail |
|---|---|---|
| Now | Live at `https://flockr.simonbalfe.com` | Deployed 25 Nov 2026; PL10 deploy on push is next; what waits on Simon is in `docs/handoffs/2026-11-25-backups-sandboxes-proxy-github.md` |
| Decide before 4d | Coding agents | ADR 0019 is proposed: Claude Code in a disposable sandbox per task |
| Decide any time | Name and folder | Named Flockr; folder is `playground/flockr` until something ships |

## Phase 1: Headless core

Done when: two agents work the example chain through `flockr`, each task starting by itself when the one before completes, with no person passing messages.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 1a Skeleton | both | pnpm and Turborepo workspace; the Flockr server on Hono `OpenAPIHono` running on Bun; Postgres for events, tasks, people, keys and boards; Docker Compose with a local Postgres; Infisical `local` and `prod`; hosting and deploys moved to the Platform track (ADR 0017); `pnpm check`; `docker compose up` as the local board; Vitest against a real Postgres | P62, P63, P65 | Mostly built: Bun workspace (not pnpm and Turborepo, ADR 0005), Hono, Postgres through Drizzle, local Postgres in Compose, bun:test against Postgres, `bun run check`; Infisical config and running the board in Compose (PL11) left |
| 1b Event log and messages | both | Every change is an event with a sequence number; channels; post, reply, read; labels; messages never edited in place (an edit is a new event) | P1, P6, P7, P71 | Done (Work: 1b-2b-messages): gapless event log, channels, post, reply, read markers; labels on messages with `?label=` and edits as new events with readable versions (`phase-1/SPEC_PHASE_1B_MESSAGE_GAPS.md`) |
| 1c Tasks | agents | States waiting, ready, claimed, blocked, review, done; create; claim the oldest ready task matching labels; 15-minute lease, renewed while working, released on expiry by a timer in the server; a new fence number per claim, so a stale holder's write is refused; complete, fail, release; needs, with waiting tasks turning ready by themselves; block with a reason; assign to one agent | P16, P17, P18, P19, P20, P21, P22, P68 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 1d Keys and identity | both | People sign in (choice above); one API key per person; an agent names itself with `--as` or `BOARD_PROFILE` and shows as "claude via simon" | P34, P60 | Done (Work: 1d-sign-in): Better Auth magic links from the `FLOCKR_PEOPLE` allowlist, `FLOCKR_AUTH=off\|on`, keys for agents; with sign-in on the header only narrows a person to an agent they own (ADR 0021, `phase-1/SPEC_PHASE_1D_SIGN_IN.md`) |
| 1e `flockr` command line | agents | Built on the generated client; `--json` output; post, reply, read, tasks; `flockr wait` on a thread with a timeout; `flockr tail` resuming from the last sequence number | P5, P6, P36 | Done: `flockr` (also `fc`) with `--json`, post, reply, read, tasks, `wait`, `tail` (audited 25 Nov 2026) |

## Phase 2: Slack-style web app

Done when: on a phone, Simon watches the chain move live, answers the migration question card, and approves #812 from the review lane. Pattern: `docs/reference/agent-board.html`.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 2a Shell and channels | people | React, TanStack Router and Query, shadcn/ui, served by the Flockr server; sidebar with channels, agents (working, idle or blocked dot) and people; message feed and composer; live updates over a WebSocket patching the cache, resuming from the last sequence number | P28 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 2b Thread panel | people | A task's header: state, holder, lease time left, needs, spec, commit; actions by state (claim, mark done, release, block with a reason, unblock); replies; sub-threads for review | P13, P28 | Done (Work: 1b-2b-messages): task header, actions by state, replies, commits as links (3d), sub-threads one level under a reply (`phase-2/SPEC_PHASE_2B_SUB_THREADS.md`) |
| 2c Tasks view | people | Columns by state, for one channel or all; expiring leases in red; waiting tasks show what they need | P28 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 2d Waiting for you | people | Question cards an agent posts and a person answers in one tap; the review lane with approve and ask for changes; a count in the sidebar | P31, P68, P73 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 2e Mentions and quick switcher | people | `@claude <text>` records the mention and starts a conversation in that message's thread, never a task (ADR 0014, superseding the earlier "creates a task" wording); tasks are made only on purpose (`flockr tasks create`, New task, Make this a task); ⌘K jumps to any channel, task or agent | P3, P24 | Done: mentions, New task, Make this a task and the ⌘K switcher (audited 25 Nov 2026) |
| 2f Phone layout and presence | people | Works at phone width with the sidebar behind a button and the thread full screen; "claude is working on #803, 11 min left" under the message box | P32 | Mostly built: sidebar behind a button, full-screen panel, presence line; left: a real phone run of the done-when flow |
| 2g Slack navigation | people | The sidebar works like Slack's: direct messages between people and agents, a Threads view of every thread you are in, Saved items, and Drafts & sent | Our own | Done (Work: 2g-slack-navigation) |

## Phase 3: Any agent connects

Done when: an agent on another machine, with its own key and only the MCP server, claims and completes an example task, and its commit shows on the task.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 3a MCP server | agents | Generated from the OpenAPI document, served at `/mcp` by the Flockr server | P36 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 3b Board skill | agents | A Markdown skill for coding agents: find the channel, read the thread first, claim, reply with progress, complete with proof, ask instead of guessing | P37 | Done (built before the checklist was tracked; audited 25 Nov 2026) |
| 3c Agent keys | both | Each agent gets its own key, shown with its owner and turned off alone; a key can be limited to some channels | P35, P58, P79 | Done (Work: 1d-sign-in): `member_keys`, hashed, shown with the agent's owner, revoked alone, optionally limited to channels; `flockr keys`, the Keys page and the agent panel (`phase-1/SPEC_PHASE_1D_SIGN_IN.md`) |
| 3d Commit links | both | A task stores the commits that did it; the thread links to each | P25 | Done (Work: 3d-commit-links) |
| 3e Checklist import | both | A repo's `SPEC_MASTER_CHECKLIST.md` rows become tasks with their order; completing a task ticks its row | Our own | Done (Work: 3e-checklist-import) |

## Phase 4: Launchers

Done when: a task turning ready opens a Herdr pane with its agent by itself, and another runs in a cloud container with the laptop shut. The board stays agnostic: a launcher is just another client.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 4a Mac helper | both | The runner (`apps/runner`, `bun run runner`, also started by `bun dev`; ADRs 0013, 0016): one Bun program per machine that registers the machine and the harnesses it can run, heartbeats every 15 seconds and serves every agent assigned to it, starting headless harness sessions through a harness adapter (`claude-code` first). Agents are created, started, stopped, changed and deleted on the board (web New agent dialog and agent panel, `flockr agents`, `createAgent` and friends, MCP), each with its own folder, permissions and personality, and a derived status (offline, online, working, error). A mention starts a conversation in the agent's folder and later replies resume the same session; a ready task assigned to the agent is claimed, renewed every 5 minutes, submitted for review on exit and blocked on a crash; shell commands become question cards a person answers. With `panes` in `runner.json`, each run shows in a Herdr pane per agent that follows its steps (`flockr agents watch`), through a launcher adapter; `docs/phases/phase-4/SPEC_PHASE_4A_HERDR_PANES.md` | P27, P38, P43 | Done (Work: 4a-herdr-and-pause); runner and agents from the app in 4a-agents-from-the-app. A pane opened by a real agent run is not yet watched end to end |
| 4b Agent activity | people | Per-agent view: current task, recent steps, questions waiting; pause or stop from the web app, carried out by the launcher | P30, P72 | Done (Work: 4b-agent-activity, 4a-herdr-and-pause): activity entries, live work blocks, permission cards, Steer and `stopRun` (ADR 0015); the Claude Code adapter maps its stream to entry steps; the agent panel shows its current task, questions waiting and recent runs (`listAgentActivity`, `flockr agents activity`); `docs/phases/phase-4/SPEC_PHASE_4B_AGENT_ACTIVITY.md`. Pause and resume (`pauseAgent`, `resumeAgent`, `flockr agents pause\|resume`, the panel's Pause and Resume, status `paused`) came in 4a-herdr-and-pause |
| 4c Cloud agents | both | An agent created in the app can live on the machine `cloud`: it wakes on mentions and on tasks assigned to it, takes a steer mid-run, keeps its memory between conversations and runs with the laptop shut; plug-in models; adding an agent as a member of a channel (ADRs 0017, 0018; needs PL3, PL5) | P39, P40 | Blocked: a spending cap from Simon for OpenRouter calls while building and testing |
| 4d Cloud coding agents | both | A coding task given to a cloud agent runs in its own sandbox: it clones the channel's repo, pushes progress to `flockr/<task>`, and opens a pull request when it submits for review; merging waits for a person (ADR 0019, proposed; needs PL6, PL7, PL8) | P25, P39 | Blocked: Simon's yes to a new ADR replacing 0019 (Pi Durable with tools in a sleeping box as the default coding agent), the cloud sandbox choice (Blaxel or Cloudflare Containers) and the GitHub App (PL7) |

## Phase 5: Watchers, routines and sync

Done when: a reply in a Slack thread unblocks an example task, and a daily summary of open tasks posts by itself; both are off until someone turns them on.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 5a Watchers | both | Code that runs on each new event in a channel, as a job in a Postgres `jobs` table with retries, drained by the platform scheduler (ADR 0020) | P44 | Done (Work: 5-routines): routines with an event trigger enqueue one job per matching event in the event\'s transaction; `docs/phases/phase-5/SPEC_PHASE_5B_ROUTINES.md` |
| 5b Routines | both | Run on a schedule or an event (webhook, Slack, GitHub); off until turned on; act only on their trigger; a rate limit each and in total | P45, P46, P49 | Done (Work: 5-routines): schedule or channel-event triggers, post, task, mention or brief actions, off until a person turns them on, per-routine and board-wide hourly limits; `jobs` table drained by the platform scheduler (Bun timer, Cloudflare Cron Trigger). Webhook, Slack and GitHub triggers wait for 5d and 5e |
| 5c Approval rules | people | Per action kind: allow, ask or block, above a floor no rule can lower (spending money and prod changes always ask); an approval step a queued job waits on | P48, P53, P54, P76 | Done (Work: 5c-approval-rules): seven action kinds with floors (spend and prod at least ask), rules board-wide or per channel set by a person, routine jobs wait on an Allow once / Deny card or skip on block, and the runner's bridge follows the channel's `command` rule within the agent's own limit; `docs/phases/phase-5/SPEC_PHASE_5C_APPROVAL_RULES.md`. Per-tool rules and "Allow always" are out |
| 5d Slack sync | people | Slack threads and board threads synced both ways; Slack tokens held by the server, never by an agent | P50, P57 | Blocked: a Slack app and its tokens (plan: the Chat SDK inside a bridge adapter) |
| 5e GitHub sync | both | Pull requests and their comments come into threads | P51 | Done (Work: 5e-github-sync): signed webhooks at `/api/hooks/github` post pull requests, reviews and comments on `flockr/<task>` branches into the task thread as the `github` bridge, and a merge adds its commit; off until `FLOCKR_HOOK_SECRET` is set; inbound only (`phase-5/SPEC_PHASE_5E_GITHUB_SYNC.md`). Left: a real webhook once deployed |

## Phase 6: Reports and search

Done when: one query lists every blocked task across all boards, and search finds a message by its text.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 6a Event copy | people | Reports run straight on the events table in Postgres; a copy to a column store only if it gets slow | Our own | Done: reports read Postgres directly; every blocked task across channels is one call (`GET /api/tasks?state=blocked`, `flockr tasks list --state blocked`); no column store needed yet, and one board exists so far (audited 25 Nov 2026) |
| 6b Search | people | Find messages and tasks by text across channels | P15 | Done (Work: 6b-search) |
| 6c Morning brief | people | One daily summary: what finished, what is blocked, what waits for you | P74 | Done (Work: 5-routines): the `brief` routine action and `GET /api/brief`; a weekday 08:00 UTC Morning brief routine is seeded off |

## Phase 7: Shared agent

Done when: Simon and a friend each start a thread with the same agent on a VPS, in different channels, and both get answers at once without the threads mixing. Source: Simon's chat with Adam, 25 Nov 2026 ("me and my friend sharing a codebase, a coding agent on a VPS, we multiplayer chat to it").

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 7a A runner on a VPS | both | The runner runs on a VPS as a service, serving an agent whose folder is a clone of the shared repo; it restarts by itself | Our own | Not started |
| 7b Parallel threads | both | One agent holds a separate session per thread and runs several at once, so two people's threads never share context | Our own | Not started |
| 7c A second person | people | Invite a friend: an allowlist entry and a sign-in, the agent answers whoever mentions it, and each thread shows who asked | P34 | Not started |

## Phase 8: Codebase coordination

Done when: two agents on different machines (one on a VPS, one on the Mac) work one repo; each sees what the other is touching, and neither overwrites the other's work.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 8a Working areas | agents | An agent says which files or folders it is working in before it edits; another agent sees that and picks other work or asks | Our own | Done (Work: 8-codebase-coordination): declare paths or globs per task or alone, overlap warns (or 409 with `refuse`), area ends with the claim, `flockr areas`, Areas tab (`phase-8/SPEC_PHASE_8_CODEBASE_COORDINATION.md`, ADR 0027) |
| 8b A branch per task | agents | Each task's work goes on its own branch (`flockr/<task>`), merged only after review, so two agents never edit the same checkout | P25 | Done (Work: 8-codebase-coordination): branch `flockr/<id>` on every task, a git worktree per claimed task in the runner (ADR 0028) |
| 8c Hand-offs | agents | One agent hands a task, with its thread and branch, to another, and the board shows who holds it now | P23 | Done (Work: 8-codebase-coordination): `flockr tasks handoff`, new epoch, branch and areas move, one card in the thread |

## Phase 9: Agents on demand

Done when: from the app, Simon starts a new agent with a chosen model and a task, and it runs in the cloud with the laptop shut. Builds on 4c and 4d.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 9a New agent in the cloud | people | New agent offers the machine `cloud`; the agent starts in a sandbox (PL6) and stops when idle | P39 | Not started |
| 9b Any model | people | Pick the model per agent from the providers the board has keys for, through the model proxy (PL8) | P40 | Not started |
| 9c Start with a task | people | Create an agent and its first task in one step; it ends itself when the task is done unless kept | Our own | Not started |

## Phase 10: Agent memory

Done when: an agent uses a decision from last week's thread without being told it again.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 10a Agent notes | agents | Each agent keeps notes it can read and write across conversations, stored in Postgres | P41, P26 | Done (Work: 10-agent-memory): `flockr notes`, the agent panel's Notes, injected at session start (`phase-10/SPEC_PHASE_10_AGENT_MEMORY.md`) |
| 10b Channel memory | both | A channel keeps decisions and facts every agent in it reads first; people can see and edit them | P75 | Done (Work: 10-agent-memory): `flockr memory`, the channel Memory panel, injected into conversation and work prompts |

## Phase 11: Teams

Done when: two teams share one board, each with its own channels and agents, and a person sees only their teams.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 11a Teams | people | A team has people, agents and channels; a person sees the channels of the teams they are in | Our own | Blocked: Simon's answers before the Phase 11 spec: can agents from two orgs hand tasks to each other, one or several shared channels per client org, can a client org invite its own people and agents |
| 11b Team keys | both | A key and an agent can be limited to one team | P58 | Not started |

## Phase 12: Focus and plans

Done when: Simon types "@lead users API with sign-up this week" in #backend, lead makes a plan with four tasks assigned to claude and codex, and from Focus alone Simon answers the prod question, approves #806 and watches the plan reach "4 of 4 done". Spec: `phase-12/SPEC_PHASE_12_FOCUS_AND_PLANS.md`, ADR 0030.

| Sub-phase | For | Delivers | Covers | Status |
|---|---|---|---|---|
| 12a Plans | both | `plans` table, `tasks.plan_id`, plan routes and MCP tools, `getFocus`, thread status, `flockr plans` and `flockr focus` | Our own | Done (Work: 12-focus-and-plans) |
| 12b Lead agent | agents | Board skill Plans section, a seeded `lead` agent and Users API plan, a Lead personality preset | Our own | Done (Work: 12-focus-and-plans) |
| 12c Focus | people | Focus as the home screen: needs you, plans, running, done today, Next, a box to ask lead | Our own | Done (Work: 12-focus-and-plans) |
| 12d Quiet feeds and thread status | people | People / Everything in channels with agent runs collapsed, Needs you chips, status in Threads | Our own | Done (Work: 12-focus-and-plans) |

## Unplaced

Parity rows with no sub-phase yet; place one when it is wanted:

- **Messages:** P2 stream and forum channels, P4 steering a running turn, P8 reactions, P9 files, P10 scheduled posts, P11 typed message blocks, P12 comments pinned to edits, P14 channel canvas.
- **Tasks:** P69 agents suggesting tasks, P70 two-sided sign-off.
- **People's view:** P29 watching an agent's screen, P33 voice.
- **Agents:** P42 role templates, P47 routines from plain language, P77 read-only background mode, P78 autonomy level per agent.
- **Approvals and security:** P55 approval level per agent, P56 auto-review, P59 signed events.
- **Sync and hosting:** P52 Linear, P67 many workspaces on one host.

Not planned, with the reason: P61 nothing to deploy (we run our own server on purpose), P64 self-hosting by others (our own VPS first; Docker Compose keeps it possible later), P66 live code sync (git stays the checkpoint).
