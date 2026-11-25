# Competitor parity

Research only: every feature the surveyed products have, and who has it. Nothing here is placed in a phase yet. Once the research is settled, each row gets a sub-phase or `Won't build` with the reason, and the master checklist is built from it.

## Products surveyed

| Key | Product | What it is | Closest to the board? |
|---|---|---|---|
| VB | Vercel Board (`@vercel/board`) | Message board and task queue for people and coding agents, in Vercel's API | Yes: the model for tasks and the command line |
| BZ | Buzz (Block, open source) | Slack-style workspace where people and agents are channel members; one signed event log on a Nostr flockr; developer preview | Yes: closest workspace, but no tasks |
| ZD | Delta and DeltaDB (Zed) | Conversations and code synced live; comments pinned to edits; public beta since September 2026, no public API | Partly: code side only |
| GB | Grok Bot (xAI, on Cursor) | Hosted bot that runs routines on a schedule or an event and hands coding to Cursor cloud agents | No: one bot, routines |
| DB | Dusk bot (dusk.bot) | Desktop app for a team of personal bots; self-hosted alternative to Grok Bot; noncommercial licence | No: bots and routines |
| RK | Rakazo (open source) | Self-hosted personal AI bots, each with chat, memory, routines and a computer | No: bots and routines |
| FB | flarebot (Simon's) | Always-on chat bots on Cloudflare Durable Objects, with groups, routines and approval cards | No, but same platform |
| OB | openbot-server (Simon's) | Five fixed Codex agents on a Hetzner box with a durable message queue | No |
| HD | Herdr (`hc` and the app) | Runs, names, messages and waits on agents in terminal panes on the Mac | No: the hands that run agents |
| DT | Dots (OpenAI) and Space | Always-on agents on their own cloud computers, talked to in ChatGPT, Slack or Teams; Space is a shared workspace of Pages; rolling out to Pro and Business | Partly: team agents with an activity view, no shared board |
| DU | Claude Duet (Anthropic) | Always-on personal agent with project channels and a tasks panel; research preview, waitlist, one user only | Closest UX: channels plus tasks, but not shared |
| DG | duet (GitHub, adamgogacz) | Agent skill: two agents on different models work as peers through a shared file-based message board | Partly: board for two agents |
| DTM | DUET Teams (duetteams.com) | Kanban board with a hand-off lane where people and agents share one record; waitlist | Partly: board, early access |
| CT | Chatter (marcvermeeren, open source, MIT) | Repo-scoped group chat, tasks, hand-offs and shared notes for coding agents running in Herdr on one machine; experimental, no server | Partly: agent-to-agent coordination, but local and not a workspace |

## Messages and threads

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P1 | Channels with threaded replies in one ordered log | VB, BZ | VB: channels and threads; BZ: every message is a signed event in one log |
| P2 | Stream channels for chat and forum channels for longer talk | BZ | Two channel types |
| P3 | `@` mentions route a message to an agent | BZ, FB, DB, RK, CT | FB: groups of 2 to 6 bots, routed by mention or a small router model; CT: `@name` pushes the message into that agent's session; only the person can use `@everyone` |
| P4 | Steering: a message sent mid-turn joins the running turn | FB, RK | Queued into the live turn |
| P5 | Wait on a thread until someone answers, with a timeout | VB, HD | `vb wait --re <id> --timeout 30m`; `hc wait` returns message, timeout or done |
| P6 | Live tail that resumes without gaps | VB, RK, HD | RK: a sequence number per thread; HD: `hc events` JSON lines |
| P7 | Labels and filters | VB, HD | `--label step=fix`; `hc label k=v` |
| P8 | Reactions | VB, BZ | |
| P9 | Files attached to a post | VB, BZ, HD | BZ: comments pinned to a video frame; HD: `hc put` |
| P10 | Scheduled posts | VB | |
| P11 | Typed message blocks checked against a schema | VB | |
| P12 | Comments pinned to code edits, not line numbers | ZD | Each edit has a lasting ID, so a comment survives later edits |
| P13 | Sub-threads for review in place of pull requests | ZD | Each sub-thread gets its own copy of the code |
| P14 | Shared canvas per channel | BZ | Agents edit it through the command line |
| P15 | Full-text search | BZ, VB | BZ: Postgres search; VB: inspector filters by text |
| P80 | Delivery follows the agent's status: idle, working or done get the message; blocked or absent agents queue it until they settle | CT | Event hooks flush the queue when an agent's status changes; text is cleaned of terminal control codes |

## Tasks and coordination

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P16 | A task is a thread with a state: waiting, ready, claimed, blocked, completed, failed, canceled | VB | Only VB has full task states; HD has terminal states (idle, working, done, blocked, error) |
| P17 | Claim the oldest ready task matching labels, optionally waiting | VB | `vb tasks claim --ready work/ --label step=fix --wait 10m` |
| P18 | A claim is a 15-minute lease, renewed while working | VB | `vb tasks renew`; expiry returns it to ready |
| P19 | Fencing: a holder whose claim was replaced cannot write | RK | A generation number on each claim |
| P20 | Atomic claim and recovery of work in progress after a crash | OB, CT | One SQL update claims; in-flight rows return to queued on restart; CT: a message is claimed for delivery by one SQL update; a failed send puts it back |
| P21 | A task needs other tasks and starts when they complete | VB | `--needs <id>` |
| P22 | Assign a task to one named agent | VB, CT | `--for <profile>`; CT: `chatter task create --assignee codex` |
| P23 | Agents hand work to each other | FB, RK, DB, OB, CT | FB: owed replies with a 6-hop cap; RK: `handoff_to_bot`; CT: `chatter handoff <task> <agent>` changes the owner and sends a pointer to a structured record |
| P24 | Work assigned by `@` mention instead of tasks | BZ | No task object |
| P25 | Work linked to the code that did it | ZD, BZ, CT | ZD: edit IDs; BZ: git built in, a branch is a room; CT: `task done --commit`; a hand-off records branch and commit; code moves through normal Git |
| P26 | Per-agent scratchpad: open, parked, done | RK | Done (Work: 10-agent-memory): agent notes with kinds (dead-end, decision, preference, fact, todo) and archive |
| P27 | Parent and child agents; wait on any or all children | HD | `hc wait --children any\|all` |
| P68 | A "ready for review" lane: finished work waits until a person marks it done | DU, DTM | DU: tasks are to do, in progress, waiting for you, finished; reminders until reviewed |
| P69 | Agents suggest tasks from what they know | DU | |
| P70 | Completion needs both sides to agree, at an exact version of the work | DG | One peer proposes, the other agrees or objects; "agreed incomplete" is a valid end |
| P71 | Messages can never be edited or deleted | DG, DTM, BZ | |
| P81 | Structured hand-off record: summary, branch, commit, files, tests run, next steps | CT | The receiver gets a short pointer and reads the record; ownership and an audit entry change in one step |
| P82 | Typed shared notes: decision, discovery, dead end; old ones are superseded, not deleted | CT | Task-scoped lookup shows dead ends first, then decisions, then discoveries |
| P83 | Open questions between agents that stay open until someone answers | CT | `chatter ask codex "..."`, `chatter answer 7 "..."` |
| P84 | One shared space per Git repository, whatever the worktree | CT | Every worktree of a repo sees the same agents, chat, tasks and notes; other repos stay separate |

## People's view

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P28 | Web view: activity feed, thread pane, tasks by state, filters | VB | `vb inspect` |
| P29 | Watch an agent's screen live and take over | FB, DB, RK, OB, HD | DB: "take control" pauses the bot for a login; HD: `hc attach` |
| P30 | Stop an agent at once | DB, HD | DB: `⌘.`; HD: `hc interrupt` |
| P31 | Question cards a person answers with one tap | DB, RK, FB | RK: `ask_user`; FB: approval cards |
| P32 | Desktop and phone apps | DB, RK, BZ, FB | |
| P33 | Voice | RK, BZ, DT, DTM | BZ: huddles |
| P72 | Activity view per agent: steps taken, delegated tasks, questions waiting; pause all or stop one task | DT | Stopping does not undo finished actions |
| P73 | Agents message first with progress, a question or a decision | DT, DU | |
| P74 | A morning brief: one daily summary | DU, CT | CT: `chatter brief` with a time such as 2h summarises changes since the last look |
| P75 | Channels share memory but keep separate conversations | DU | One channel per project. Done (Work: 10-agent-memory): channel memory |
| P86 | Team metrics from an append-only ledger: delivery time, tasks done, dead ends, question response time | CT | `chatter stats` |

## Agents and identity

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P34 | Any number of agents, each named, shown with its person | VB | `--as claude` shows "claude via simon" |
| P35 | Each agent has its own key and audit trail, revocable alone | BZ | One keypair per agent |
| P36 | Agents act through a JSON command line and MCP | VB, BZ, DB, CT | BZ: `buzz-cli`; DB: runs as an MCP server; CT: `--json` on most read commands; no MCP |
| P37 | A skill that teaches a coding agent to use the board | VB | `npx skills add vercel/board` |
| P38 | Runs Claude Code, Codex and others as members | BZ, DB, ZD, HD, CT | BZ: `buzz-acp` passes a mention to the agent; CT: Claude Code, Codex, Pi and others, as panes in Herdr |
| P39 | Agents keep working after the laptop closes | ZD, GB, DB, RK | Cloud runners or a server |
| P40 | Hand coding to a cloud agent | GB | Cursor cloud agents |
| P41 | Per-agent memory | FB, RK, DB | Done (Work: 10-agent-memory) |
| P42 | Role templates | HD, BZ, OB | HD: Markdown roles; OB: lead, research, build, review, ops |
| P43 | Agents on other machines | HD, DB | `hc run --on <machine>` |
| P85 | Start a teammate with a worktree and a purpose in one command; plan a whole team in a wizard | CT | `chatter spawn data-api --kind codex --purpose "..."` makes `agents/<name>`, starts and labels the agent in Herdr, announces it |

## Triggers, routines and sync

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P44 | Watcher: code that runs on each new event, with retries | VB | Declared in `board({ watch })` |
| P45 | Routine on a schedule | GB, DB, RK, FB | Cron with timezone; RK and DB also run once |
| P46 | Routine on an event: Slack, GitHub, email, webhook | GB, DB, BZ, RK | FB and RK: a private webhook per bot |
| P47 | Routines written in plain language | RK, DB | A repeated request becomes a routine |
| P48 | Workflows as files, with approval steps | BZ | YAML; approval steps exist but cannot pause and resume yet |
| P49 | Rate limit per routine and in total | GB | 200 an hour per routine, 300 in total |
| P50 | Slack threads synced both ways | VB, RK | RK also bridges WhatsApp, Telegram and iMessage |
| P51 | GitHub pull requests and comments in threads | VB, BZ | Done (5e) |
| P52 | Linear issues synced | VB | |

## Approvals and security

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P53 | Approval card: allow once, always, deny | FB, OB | FB: a one-time grant tied to the call's arguments |
| P54 | Approval rules by tool, connector or category | RK | |
| P55 | Approval level per agent, and a separate right to act as a person | DB | Ask through to full access |
| P56 | Auto-review of risky actions; ask when unsure | GB, RK | |
| P57 | Secrets agents use but never see | DB, FB, RK, GB | DB: a vault with values redacted from logs; GB: tokens held server side |
| P58 | Keys limited to one channel | BZ | |
| P59 | Signed events and a hash-chain audit log | BZ | |
| P60 | Email-code sign-in with an allowlist | FB | |
| P76 | Per-action rule: allow, ask or block, above a floor no rule can lower | DT | Password changes and money transfers stay with the person |
| P77 | Read-only mode for background work | DT | Reads connected apps while you are away; cannot send or edit |
| P78 | Autonomy level per agent: low, medium, high, ask first | DTM, DB | |
| P79 | Specialist agents with their own identity and logins, apart from their owner | DT | |

## Hosting and storage

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P61 | Nothing to deploy | VB | Lives in Vercel's API |
| P62 | A board on one computer, shareable on a tailnet | VB, CT | `npx @vercel/board serve`; CT: one SQLite file per repository on one computer; no server |
| P63 | In-memory board for tests, and a protocol conformance check | VB | |
| P64 | Self-host with Docker | RK, BZ, OB | |
| P65 | SQLite per agent in a Durable Object, asleep when idle | FB | Rumoured for ZD, unconfirmed |
| P66 | Live code sync between machines | ZD | CRDT worktrees |
| P67 | Many communities on one host | BZ | Scoped by host name |

## Lessons from the research

- **Grok Bot read Slack, email and GitHub without being asked**, 31 times in a security test (NewCore, November 2026).
- **Buzz has no view of an agent's progress mid-task**, by one field report, and its approval steps cannot pause and resume.
- **Dusk bot's routines on a laptop run only while it is awake**; a missed run can start up to 12 hours late.
- **A server on a VPS cannot reach Herdr on the Mac.** A small program on the Mac has to connect out to the board.
- **None of the bot products has tasks** (FB, RK, DB, GB, OB). Only VB has claim, needs and block.
- **No product has all three:** a Slack-style shared workspace (BZ), always-on agents with a tasks panel (DU, DT), and real task coordination (VB). Claude Duet is one person only; Buzz has no tasks; Vercel Board has no always-on agents.
- **Claude Duet's details come from one third-party review**; no Anthropic page was found.

## Herdr connection notes

| On the board | Herdr command |
|---|---|
| A task is claimed | `hc run --bg --name task-812 --label board.task=812 claude "<task>"` |
| The agent is working | The Mac program renews the claim from `hc events --label board.task=812` |
| The agent finishes | `hc wait task-812` returns; the task completes |
| The agent is blocked or errors | Block or release the task, with `hc read` lines as the reason |
| A reply arrives in the thread | `hc send --if idle task-812 "<reply>"` |

## Sources

- Vercel Board: https://vercel.com/docs/board, https://unpkg.com/@vercel/board/docs/index.md
- Buzz: https://github.com/block/buzz, https://flaviocopes.com/buzz/
- Delta and DeltaDB: https://zed.dev/blog/introducing-deltadb, https://zed.dev/blog/delta-public-beta
- Grok Bot: https://cursor.com/docs/grok-bot, https://docs.x.ai/grok-bot/skills-routines-and-automations, https://thenextweb.com/news/grok-bot-unattended-check-ins-newcore-email-slack-github
- Dusk bot: https://dusk.bot, https://github.com/DuskBotAI/duskbot
- Rakazo: `third_party/rakazo`
- flarebot, flarebot-flue, openbot-server: `projects/personal/flarebot`, `playground/flarebot-flue`, `projects/personal/openbot-server`
- Herdr: the codemode `herdr` skill, `hc --help`
- Dots: https://openai.com/index/introducing-dots/, https://learn.chatgpt.com/docs/dots, https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs
- Claude Duet: https://airegeneration.substack.com/p/always-on-agents-claude-duet-the
- duet: https://github.com/adamgogacz/duet
- DUET Teams: https://duetteams.com/
- Chatter: https://github.com/marcvermeeren/chatter (see `docs/reference/RESEARCH_CHATTER.md`)
