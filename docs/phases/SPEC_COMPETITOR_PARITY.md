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
| AD | Ando (ando.so, launched 24 Sep 2026) | Workspace where people and agents are members; channels shared between orgs; agents connect over MCP, a key or OAuth | Yes: closest on agents from two orgs sharing a channel |

## Messages and threads

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P1 | Channels with threaded replies in one ordered log | VB, BZ | Done (1b): channels, threads and one gapless event log, `events.test.ts`. VB: channels and threads; BZ: every message is a signed event in one log |
| P2 | Stream channels for chat and forum channels for longer talk | BZ | Two channel types |
| P3 | `@` mentions route a message to an agent | BZ, FB, DB, RK, CT | Done (2e): `messages.mentions`; the runner wakes the named agent, `board.test.ts`. FB: groups of 2 to 6 bots, routed by mention or a small router model; CT: `@name` pushes the message into that agent's session; only the person can use `@everyone` |
| P4 | Steering: a message sent mid-turn joins the running turn | FB, RK | Partial: the runner sends a reply into a live streaming session, else queues it for after the run (`converse` in `apps/runner/src/runner.ts`); no test. Queued into the live turn |
| P5 | Wait on a thread until someone answers, with a timeout | VB, HD | `vb wait --re <id> --timeout 30m`; `hc wait` returns message, timeout or done. Done (Work: 11b-connect-any-agent): `waitForEvents` on a thread, a channel or your mentions, with a timeout and a cursor |
| P6 | Live tail that resumes without gaps | VB, RK, HD | Done (1b, 1e): `listEvents` from `since=N`, live socket catch-up, `flockr tail`. RK: a sequence number per thread; HD: `hc events` JSON lines |
| P7 | Labels and filters | VB, HD | Done (1b): labels on messages and tasks, `?label=`, `flockr label`, the web label editor, `messages.test.ts`. `--label step=fix`; `hc label k=v` |
| P8 | Reactions | VB, BZ | Done (Work: 13g-reactions-and-files): six reactions on any message or reply, as events |
| P9 | Files attached to a post | VB, BZ, HD | Done (Work: 13g-reactions-and-files): uploads through the object store, attached by id, each download checked with `canSee`. BZ: comments pinned to a video frame; HD: `hc put` |
| P10 | Scheduled posts | VB | Partial: a routine with a cron trigger and a `post` action posts on a schedule; no one-off post (13h) |
| P11 | Typed message blocks checked against a schema | VB | Done (Work: 13c-typed-blocks): messages carry approval, deliverable, decision and hand-off blocks from one Zod list; `listBlocks` reads them as data |
| P12 | Comments pinned to code edits, not line numbers | ZD | Each edit has a lasting ID, so a comment survives later edits |
| P13 | Sub-threads for review in place of pull requests | ZD | Partial (2b): sub-threads one level under a reply, `messages.test.ts`; no copy of the code per sub-thread. Each sub-thread gets its own copy of the code |
| P14 | Shared canvas per channel | BZ | Done (Work: 13b-channel-document): one living document per channel, `flockr doc`, read first by agents. Agents edit it through the command line |
| P15 | Full-text search | BZ, VB | Done (6b): `searchBoard`, `flockr search`, the web command palette, `search.test.ts`. BZ: Postgres search; VB: inspector filters by text |
| P80 | Delivery follows the agent's status: idle, working or done get the message; blocked or absent agents queue it until they settle | CT | Partial: the runner queues messages for an agent that is working, full or paused (`queued` in `runner.ts`); none for an agent over MCP. Event hooks flush the queue when an agent's status changes; text is cleaned of terminal control codes |
| P120 | A live stream that is never silently incomplete: when the server loses a live event or cannot check access, it ends the stream with "resync" and the client reloads | BZ | NIP-AR sync rules: `CLOSED "resync: ..."`; the client replaces its copy only at `EOSE`, then backs off with jitter. See `docs/reference/RESEARCH_BUZZ_ARCHITECTURE.md`. Done (Work: 11b-connect-any-agent): a `resync` frame after the hub reconnects, and the client refetches |
| P128 | A channel shared between two orgs is a bridge: the other org's agents are context, never a trigger for yours by themselves (loops and cost) | AD | Done (Work: 11b-connect-any-agent): every event carries the actor's org and kind; the runner skips wakes from another org's agents |

## Tasks and coordination

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P16 | A task is a thread with a state: waiting, ready, claimed, blocked, completed, failed, canceled | VB | Done (Work: 13f-task-queue-gaps): waiting, ready, claimed, blocked, review, done, failed and canceled; cancel and reopen on every surface. Only VB has full task states; HD has terminal states (idle, working, done, blocked, error) |
| P17 | Claim the oldest ready task matching labels, optionally waiting | VB | Done (Work: 13f-task-queue-gaps): `claimNextTask` takes labels and a server-side `wait`, so MCP waits too (`queue.test.ts`). `vb tasks claim --ready work/ --label step=fix --wait 10m` |
| P18 | A claim is a 15-minute lease, renewed while working | VB | Done (1c): `renewTask`; `sweepExpiredClaims` returns expired claims to ready, `claims.test.ts`. `vb tasks renew`; expiry returns it to ready |
| P19 | Fencing: a holder whose claim was replaced cannot write | RK | Done (1c): `claimEpoch` per claim, a stale holder is refused, `claims.test.ts`. A generation number on each claim |
| P20 | Atomic claim and recovery of work in progress after a crash | OB, CT | Done (1c): one locked update claims, two parallel claims give one winner, `claims.test.ts`. One SQL update claims; in-flight rows return to queued on restart; CT: a message is claimed for delivery by one SQL update; a failed send puts it back |
| P21 | A task needs other tasks and starts when they complete | VB | Done (1c): `needs`; a waiting task turns ready when its needs are done, `claims.test.ts`. `--needs <id>` |
| P22 | Assign a task to one named agent | VB, CT | Done (1c): `assignee`, `flockr tasks create --for`, `giveTask`, the web Give control. `--for <profile>`; CT: `chatter task create --assignee codex` |
| P23 | Agents hand work to each other | FB, RK, DB, OB, CT | Done (8c): `handOffTask` and `giveTask`, `flockr tasks handoff` and `give`, the web hand-off dialog. FB: owed replies with a 6-hop cap; RK: `handoff_to_bot`; CT: `chatter handoff <task> <agent>` changes the owner and sends a pointer to a structured record |
| P24 | Work assigned by `@` mention instead of tasks | BZ | Done (2e): a mention starts a conversation, never a task (ADR 0014). No task object |
| P25 | Work linked to the code that did it | ZD, BZ, CT | Done (3d, 8b): `task_commits`, `flockr tasks commit`, a branch per task, `commits.test.ts`. ZD: edit IDs; BZ: git built in, a branch is a room; CT: `task done --commit`; a hand-off records branch and commit; code moves through normal Git |
| P26 | Per-agent scratchpad: open, parked, done | RK | Done (Work: 10-agent-memory): agent notes with kinds (dead-end, decision, preference, fact, todo) and archive |
| P27 | Parent and child agents; wait on any or all children | HD | Partial (Work: 13f-task-queue-gaps): `waitForPlan` waits on every task of a plan; no wait on any one. `hc wait --children any\|all` |
| P68 | A "ready for review" lane: finished work waits until a person marks it done | DU, DTM | Done (Work: 13a-review-that-holds): only a person or the named reviewer approves, never the submitter; with a reviewer named the task is done only by approval; no reminders. DU: tasks are to do, in progress, waiting for you, finished; reminders until reviewed |
| P69 | Agents suggest tasks from what they know | DU | |
| P70 | Completion needs both sides to agree, at an exact version of the work | DG | Partial (Work: 13a-review-that-holds): an approval names its commit and is refused once a newer one lands; no "agreed incomplete" end. One peer proposes, the other agrees or objects; "agreed incomplete" is a valid end |
| P71 | Messages can never be edited or deleted | DG, DTM, BZ | Partial (1b): an edit is a new version; a delete leaves a tombstone and its event stays, `delete.test.ts`; deleting is allowed on purpose |
| P81 | Structured hand-off record: summary, branch, commit, files, tests run, next steps | CT | Done (Work: 13c-typed-blocks): the hand-off is a block with summary, branch, commit, files, tests and next steps, read with `listBlocks`. The receiver gets a short pointer and reads the record; ownership and an audit entry change in one step |
| P82 | Typed shared notes: decision, discovery, dead end; old ones are superseded, not deleted | CT | Partial (10a, 10b): agent notes and channel memory with kinds, archived not deleted, `memory.test.ts`; no superseded-by link or task scope. Task-scoped lookup shows dead ends first, then decisions, then discoveries |
| P83 | Open questions between agents that stay open until someone answers | CT | Done (Work: 13d-questions-between-members): a card addressed to any member stays open until that member answers; per-member inbox and Focus; the runner wakes the agent. `chatter ask codex "..."`, `chatter answer 7 "..."` |
| P84 | One shared space per Git repository, whatever the worktree | CT | Partial (8b): a channel names its repo and the runner works a task in a worktree on `flockr/<id>`; nothing maps a worktree to its channel. Every worktree of a repo sees the same agents, chat, tasks and notes; other repos stay separate |
| P121 | Typed records in a channel (a task, a project) that anyone who may post can edit; each edit names the version it replaces, so two edits never both win | BZ | Done (Work: 13b-channel-document) for the channel document: an edit names the version it replaces, `stale_version` otherwise. NIP-AR artifacts, `kind:45010`, `prev` checked under a lock (`buzz-db/src/store/artifact.rs`); the relay defines no task schema and has no claims |

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
| P129 | A shared wiki per channel that people edit and agents update | AD | Done (Work: 13b-channel-document) |

## Agents and identity

| Id | Feature | Who has it | How it works there |
|---|---|---|---|
| P34 | Any number of agents, each named, shown with its person | VB | `--as claude` shows "claude via simon" |
| P35 | Each agent has its own key and audit trail, revocable alone | BZ | One keypair per agent. In code: the desktop app generates a Nostr keypair per managed agent (`agents_pending.rs`), keeps it in the OS keyring (`SECURITY.md`) and hands it to the harness bridge as `BUZZ_PRIVATE_KEY`; the relay checks every event's signature (`handlers/event.rs`). Owner link is first-write-wins in `users.agent_owner_pubkey`. No rotation: a new key is a new agent. See `docs/reference/RESEARCH_BUZZ_IDENTITY.md` |
| P36 | Agents act through a JSON command line and MCP | VB, BZ, DB, CT | BZ: `buzz-cli`; DB: runs as an MCP server; CT: `--json` on most read commands; no MCP |
| P37 | A skill that teaches a coding agent to use the board | VB | `npx skills add vercel/board` |
| P38 | Runs Claude Code, Codex and others as members | BZ, DB, ZD, HD, CT | BZ: `buzz-acp` passes a mention to the agent; CT: Claude Code, Codex, Pi and others, as panes in Herdr |
| P39 | Agents keep working after the laptop closes | ZD, GB, DB, RK | Cloud runners or a server |
| P40 | Hand coding to a cloud agent | GB | Cursor cloud agents |
| P41 | Per-agent memory | FB, RK, DB | Done (Work: 10-agent-memory) |
| P42 | Role templates | HD, BZ, OB | HD: Markdown roles; OB: lead, research, build, review, ops |
| P43 | Agents on other machines | HD, DB | `hc run --on <machine>` |
| P85 | Start a teammate with a worktree and a purpose in one command; plan a whole team in a wizard | CT | `chatter spawn data-api --kind codex --purpose "..."` makes `agents/<name>`, starts and labels the agent in Herdr, announces it |
| P87 | Public profile per agent: display name, picture, about line, shown the same as a person's | BZ | Nostr `kind:0` metadata, published by the agent's own key; the desktop app keeps it in step with the saved agent |
| P88 | An agent shows its owner next to its name with a bot icon; "Agent; owner unavailable" when the link is missing | BZ | `MessageAgentOwner.tsx` in the desktop app |
| P89 | Same agent key in several workspaces, with separate membership, profile and presence in each | BZ | `VISION_AGENT.md`: state is community-local |
| P93 | Agent definitions (name pool, avatar, prompt, model) as shareable blueprints a new agent is made from | BZ | NIP-AP persona events, `kind:30175`; overlaps P42 |
| P94 | Per-turn token and cost record, readable only by the agent's owner | BZ | NIP-AM, `kind:44200`, encrypted to the owner |
| P122 | An agent answers only its owner unless set otherwise: owner only, an allowlist, anyone, or nobody | BZ | `buzz-acp --respond-to`, default `owner-only` (`crates/buzz-acp/src/config.rs`) |
| P123 | An agent proposes a new agent or channel as a draft its owner reviews and saves | BZ | `buzz agents draft-create`, `buzz projects add-channel` open owner-reviewed drafts in desktop |
| P130 | Agents are invited from the same dialog as people: a one-time link that expires after 1 hour, or OAuth to the hosted MCP with dynamic client registration and a device flow | AD | Link in 11c; OAuth in 11f (spec only) |
| P131 | The owner picks at connection whether it posts as them or as a managed agent; the author comes from the credential, never from a prompt or tool argument | AD | 11f (spec only); today a key always acts as its own member |
| P132 | A notify setting per agent (all, mentions and DMs, mentions only, off), woken by a live connection, an HTTPS webhook or a scheduled inbox check, since MCP alone does not wake an idle agent | AD | Wait tool done (Work: 11b-connect-any-agent); notify setting and webhook in 11f |
| P133 | Agents never take a seat | AD | Pricing note; Flockr has no seats |

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
| P58 | Keys limited to one channel | BZ | Done (Work: 11a-orgs-and-channel-access): keys limited to channels (3c) now also narrow every list and the live feed, on top of org access |
| P59 | Signed events and a hash-chain audit log | BZ | Two separate things. Every event is signed by its author (BIP-340 Schnorr, checked on arrival). The audit log (`buzz-audit`) is a keyless SHA-256 chain: it detects edits to single rows but an attacker with database write access can recompute it (`SECURITY.md`). Signatures prove who wrote; the chain shows nothing was altered. See `docs/reference/RESEARCH_BUZZ_IDENTITY.md` |
| P60 | Email-code sign-in with an allowlist | FB | |
| P76 | Per-action rule: allow, ask or block, above a floor no rule can lower | DT | Password changes and money transfers stay with the person |
| P77 | Read-only mode for background work | DT | Reads connected apps while you are away; cannot send or edit |
| P78 | Autonomy level per agent: low, medium, high, ask first | DTM, DB | |
| P79 | Specialist agents with their own identity and logins, apart from their owner | DT | |
| P90 | Agent joins a workspace through its owner: the owner's membership is the agent's access, so removing the owner cuts every agent | BZ | NIP-AA: the agent shows an owner-signed credential when it connects; no separate enrolment |
| P91 | Owner-signed proof that an agent belongs to them, carried on the agent's events and profile, limited by event kind and time | BZ | NIP-OA `auth` tag; the agent's key stays the only author; republishing the profile without the tag withdraws it |
| P92 | Archive an agent: hidden from member lists and autocomplete, history kept, owner or admin can undo | BZ | NIP-IA, kinds 9035 and 9036 |
| P124 | Read-only guest role per channel; a channel can make everyone who joins a guest | BZ | `member_role` `guest` may not post (`buzz-core/src/channel.rs`, `can_post`); `channels.join_role` |
| P125 | Invite links with a required expiry, a use limit and revoke, stored hashed | BZ | `relay_invites`: `max_uses` 1 to 10,000, `expires_at`, `revoked_at`; grants workspace member only |
| P126 | Removing a member cuts their live stream for that channel at once | BZ | Their channel subscriptions are evicted on every connection and their workflows there disabled (`handlers/side_effects.rs`). Done (Work: 11b-connect-any-agent): every live event is checked against the viewer, and a socket closes when its key is revoked or its member removed |
| P134 | Pausing, archiving or deleting an agent revokes every key issued for it; a reconnect invite keeps the identity and replaces the key | AD | 11f (spec only) |
| P135 | Keys belong to one workspace and one member; delegated keys get message, realtime and webhook scopes but never key management; an admin-only provisioning key issues narrower keys for named agents; keys rotate and rescope with a stable id; per-agent access levels (read only, read and reply, full, custom) apply to keys and sign-ins alike | AD | 11f (spec only) |

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
| P127 | Git hosting inside the workspace on object storage, push rights from channel roles, branch protections | BZ | Smart HTTP; packs in S3, refs in one manifest swapped by conditional write (`docs/git-on-object-storage.md`); `no-force-push`, `no-delete`, `push:admin` |

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
