# Research: how Buzz is built, and what Flockr should take from it

Extends `docs/reference/RESEARCH_BUZZ_IDENTITY.md` (keys, owners, profiles: not redone here). Added for `BZ` in `docs/phases/SPEC_COMPETITOR_PARITY.md`: new rows P120 to P127, numbered above P112 because uncommitted edits in the main checkout already use P95 to P112. Source read: `github.com/block/buzz`, shallow clone at commit `55823dd` (25 Nov 2026) in `~/workspace/dev/third_party/buzz`, read only, nothing built or run; open issues read with `gh issue list` on 28 Nov 2026 (1,793 open). Paths are in that repo unless they start with `apps/`, `packages/` or `docs/phases/`. Each finding says **Code** (seen in source), **Spec** (a NIP or formal doc, not checked against code), **Claim** (README or vision only) or **Inferred**.

## In one table

| Question | Answer |
|---|---|
| What is it | A Nostr relay with a chat product on top: every message, reaction, membership change, workflow step and git status is a signed event in one Postgres table |
| Size | About 700,000 lines of Rust in 34 crates; the relay (230k) and its Postgres layer (136k) are two thirds of it |
| Clients | Mobile (Flutter, `mobile/`) and the deprecated 0.X desktop (`desktop/`, Tauri and React) are here; desktop 1.0 lives in `block/buzz-app`, not read |
| Tasks | No board. Tasks are client-defined records (artifacts, `buzz.task`) or git issues, edited with compare-and-set; no claims, leases or needs |
| Access | Channel membership is the only gate, checked on every write, history read, live delivery and search hit |
| Tenancy | A community (workspace) is picked by the request's host name; every row carries `community_id`; nothing is shared across communities |
| Ordering | No sequence number. Rows are keyed by the signer's `created_at` plus event id; catch-up is `since` a timestamp |
| Agents | A key, a bridge (`buzz-acp`) that turns mentions into prompts for any ACP agent, and the `buzz` CLI to reply. The bridge auto-approves every tool call |

## 1. The parts

| Part | What it does | Where | Status |
|---|---|---|---|
| `buzz-relay` | Axum server: WebSocket (NIP-01), HTTP bridge (`/events`, `/query`, `/count`), media, git smart HTTP, huddle audio, operator and invite routes | `crates/buzz-relay/src/router.rs` | Code |
| `buzz-core` | No I/O: event kinds (143 constants), filter matching, signature check, SSRF address check | `crates/buzz-core/src/kind.rs` | Code |
| `buzz-db` | Every Postgres read and write, membership rules, partitions, deletion | `crates/buzz-db/src/store/` | Code |
| `buzz-auth` | NIP-42 (signed challenge), NIP-98 (signed HTTP request), scopes | `crates/buzz-auth/src/lib.rs` | Code |
| `buzz-pubsub` | Redis fan-out between relay pods, presence, typing, the rate limiter | `crates/buzz-pubsub/src/` | Code |
| `buzz-search` | Postgres full-text search, OpenSearch as an option | `crates/buzz-search/` | Code |
| `buzz-audit` | Keyless SHA-256 chain over stored rows (see the identity doc) | `crates/buzz-audit/src/hash.rs` | Code |
| `buzz-workflow` | YAML workflows: 4 triggers, 7 actions, cron | `crates/buzz-workflow/src/` | Code; approval steps unfinished |
| `buzz-acp` | Agent bridge: relay mentions in, ACP prompts out to goose, Codex or Claude Code | `crates/buzz-acp/` | Code |
| `buzz-agent` | Buzz's own minimal ACP agent, non-streaming, no persistence | `crates/buzz-agent/README.md` | Code |
| `buzz-dev-mcp` | Shell and file-edit tools for agents | `crates/buzz-dev-mcp/` | Code |
| `sprig` | One image with bridge, agent and tools, run by remote backends | `crates/sprig/` | Code |
| `buzz-cli` | Agent-first CLI, JSON in and out: messages, channels, repos, issues, PRs, projects, workflows | `crates/buzz-cli/src/commands/` | Code |
| `buzz-sdk` | Typed event builders for the CLI and bridge | `crates/buzz-sdk/` | Code |
| `buzz-persona` | Persona packs (`.persona.md`) that agents are made from | `crates/buzz-persona/` | Code |
| `buzz-backend-kubernetes` | Runs a managed agent as a bare pod | `docs/remote-agents.md` | Code and Spec |
| `buzz-relay-mesh` | QUIC mesh between relay pods (iroh), for traffic that cannot go through Redis | `crates/buzz-relay-mesh/src/lib.rs` | Code |
| `buzz-push-gateway` | Wakes phones; carries nothing about the event | `CONTEXT.md` | Code |
| `git-sign-nostr`, `git-credential-nostr` | Sign commits with the Nostr key; NIP-98 credentials for `git push` | `crates/git-*` | Code |
| `buzz-media` | Blossom uploads to S3, 50 MB limit, thumbnails | `crates/buzz-media/` | Code |
| `buzz-admin` | Operator CLI: relay members, keys, community deletion | `crates/buzz-admin/` | Code |
| `admin-web` | Operator web console | `admin-web/` | Code, not read |

### How they talk

| From | To | How |
|---|---|---|
| Any client | Relay | WebSocket, NIP-01 frames (`EVENT`, `REQ`, `CLOSE`, `AUTH`), login by signing a challenge (NIP-42) |
| Clients without a socket (app-hosted agents, CLI) | Relay | HTTP `POST /events` and `/query`, each request signed (NIP-98); same ingest path as the socket |
| Desktop | Relay | A small private REST surface, `/buzz/v1/me/sidebar` and `/me/read-state` only (`api/buzz_v1/mod.rs`: "Conversation authority remains signed Nostr events") |
| Bridge | Agent | ACP, JSON-RPC over stdio |
| Agent | Relay | Runs the `buzz` CLI (or MCP), signing with `BUZZ_PRIVATE_KEY` |
| Relay pod | Relay pod | Redis `PUBLISH`, 16 ordered delivery workers per pod; QUIC mesh for tunnels |
| Git client | Relay | Smart HTTP at `/git/{owner}/{repo}`, NIP-98 credentials |

There is almost no REST API for chat: creating a channel, adding a member or pinning a message is a signed event of a given kind (NIP-29 kinds 9000 to 9009), which the relay applies.

### C4 container sketch

| Container | Technology | Does | Talks to |
|---|---|---|---|
| People | Mobile app, desktop app | Chat, approve owner-reviewed drafts, run local agents | Relay over WebSocket |
| Agent host | `buzz-acp` plus goose, Codex or Claude Code | Wakes on mentions, prompts the agent, keeps one session per channel or thread | Relay over WebSocket and HTTP; agent over stdio |
| Remote agent | `sprig` image in a Kubernetes pod | Same as agent host, launched by a backend program | Relay; status only through presence |
| Relay pods (N, stateless) | Rust, Axum | Auth, signature check, membership check, store, fan-out, search, workflows, git, huddles | Postgres, Redis, S3, each other over QUIC |
| Postgres | Postgres 17 | Events (partitioned by month), channels, members, users, workflows, audit, artifacts | Relay |
| Redis | Redis 7 | Pub/sub between pods, presence, typing, rate limits | Relay |
| Object store | S3 or MinIO | Media blobs, git packs and the ref manifest | Relay |
| Push gateway | Rust | Wake signal to phones | APNs and FCM |
| Feature flags | LaunchDarkly | Tightens concurrency caps at run time | Relay |

## 2. The data model

### Event kinds (selected; full list `crates/buzz-core/src/kind.rs`, Code)

| Area | Kinds |
|---|---|
| Messages | 9 stream message, 40002 v2, 40003 edit, 40008 diff, 45001 forum post, 45003 forum comment, 7 reaction, 5 deletion |
| Channels and membership (NIP-29) | 9000 put user, 9001 remove user, 9002 edit metadata, 9005 delete event, 9007 create group, 9021 join request, 9022 leave; relay-signed state 39000 to 39003 |
| Workspace membership (NIP-43) | 13534 member list, 8000 added, 8001 removed |
| DMs | 41001 created, 41010 open, 41011 add member, 41012 hide, 1059 gift wrap |
| Agents | 10100 agent profile, 30174 memory (engram, encrypted), 30175 persona, 30177 managed agent, 44200 turn metric, 20003 owner heartbeat for its agents |
| Work | 45010 artifact (typed editable record), 43001 to 43006 jobs (shown in the feed only), 30620 workflow definition, 46001 to 46012 workflow run, 46030 and 46031 approval grant and deny |
| Git (NIP-34) | 30617 repo announcement, 30618 repo state, 1617 patch, 1618 pull request, 1621 issue, 1630 to 1633 status; 30621 multi-repo project |
| Shared document | 40100 canvas, one per channel |
| Not stored | 20000 to 29999: presence 20001, typing 20002 |

### Tables (`schema/tables/public/`, Code)

| Table | Holds | Note |
|---|---|---|
| `events` | Every stored event: id, pubkey, kind, tags (JSONB), content, sig, `channel_id`, `deleted_at`, generated `search_tsv` | Primary key `(community_id, created_at, id)`; range-partitioned by month |
| `channels` | Type (`stream`, `forum`, `dm`, `workflow`, `system`), visibility (`open`, `private`), `unlisted`, `join_role` (`member` or `guest`), canvas text, topic, TTL | DMs are channels with a `participant_hash` |
| `channel_members` | `(community, channel, pubkey)`, role (`owner`, `admin`, `member`, `guest`, `bot`), `removed_at`, `invited_by` | Soft delete |
| `relay_members` | Workspace membership: `owner`, `admin`, `member` | NIP-43 |
| `users` | Profile copied from kind 0, `agent_owner_pubkey`, `channel_add_policy` | Per community |
| `thread_metadata` | Parent, root, depth, reply and descendant counts per reply | Written with the event |
| `reactions`, `event_mentions` | Read models for reactions and the mentions feed | |
| `communities` | Host name, signing key, deletion state | One row per workspace |
| `relay_invites` | Hashed token, `max_uses` 1 to 10,000, `expires_at` required, revocable | Grants workspace `member` only |
| `api_tokens` | Hashed token, scopes, `channel_ids` | Only revoke is wired; see section 3 |
| `workflows`, `workflow_runs`, `workflow_approvals` | Definitions, runs, hashed single-use approval tokens | |

No foreign keys, triggers or functions: migrations 0102 to 0104 dropped the last ones, and the application owns every reference (`docs/database.md`, Code).

### From signed event to rows (`crates/buzz-relay/src/handlers/ingest.rs`, Code)

1. Authenticated, scope allows writing, `event.pubkey` equals the logged-in key.
2. Clock check: `created_at` within ±900 seconds of the server (`ingest.rs:2685`); canvas ±300.
3. Signature and id checked.
4. Membership check (`check_channel_membership`, `ingest.rs:960`), then the role may post.
5. Kind-specific apply in the same transaction: a 9000 adds a `channel_members` row, a reply writes `thread_metadata`, a canvas takes an advisory lock on the channel head.
6. Insert into `events`, `ON CONFLICT DO NOTHING` (a resent event is a no-op).
7. Publish to Redis, fan out locally, then audit and workflows as fire-and-forget tasks.

### Ordering and edits

| Rule | Detail | Status |
|---|---|---|
| No sequence | Order is `created_at` (chosen by the signer, seconds) then id. Two events in the same second order by hash | Code |
| Catch-up | `REQ` with `since` a timestamp, up to 500 events per filter; client dedupes by id (Inferred) | Code |
| Edits | A new event (40003) pointing at the original; reads return the latest live edit (`docs/effective-message-edits.md`) | Code |
| Deletes | Kind 5 or 9005 sets `events.deleted_at`; the signed row stays | Code |
| Artifacts | Every revision names the current one in `prev`; the relay advances it atomically, so two competing edits cannot both win; timestamps never pick the winner (`docs/nips/NIP-AR.md`) | Code (`buzz-db/src/store/artifact.rs`: advisory lock, head row `FOR UPDATE`, stale `prev` refused) |
| Canvas | Whole document per event; a write tagged with the expected head is compare-and-set, an untagged write simply wins (`buzz-db/src/store/event.rs`, `insert_canvas_head_checked`) | Code |

### Search

Postgres generated column `to_tsvector('simple', content)` on `events`, GIN index, private kinds (gift wraps, reminders, DM visibility, turn metrics) indexed as `NULL`. `buzz-search` returns candidates only; the relay re-checks access on every hit before returning it. OpenSearch is an alternative backend fed by `search_outbox`. Open issue #10005: fresh installs do not index artifacts. (Code)

## 3. Access

| Question | Answer | Where | Status |
|---|---|---|---|
| Who may read a channel | Its active members, plus every workspace member for an open listed channel | `get_accessible_channel_ids`, `buzz-db/src/store/channel_members.rs:1688` | Code |
| Who may post | An active member whose role is not `guest`; a non-member only in an open channel whose `join_role` is `member` | `may_post`, `ingest.rs`; `MemberRole::can_post`, `buzz-core/src/channel.rs:493` | Code |
| Guests | A per-channel role that reads but never writes; an open channel can make every joiner a guest | `channels.join_role` | Code |
| Live subscriptions | Access checked before the subscription is registered, so no event slips in between; channel events never reach a subscription without a channel filter | `handlers/req.rs`, `ARCHITECTURE.md` section 5 | Code |
| Each delivery | Fan-out checks each recipient again, in bulk; a recipient whose check fails misses the event and gets `resync` on syncs | `handlers/multinode_fanout.rs` | Code |
| Removal | Removing a member closes their live channel subscriptions on every connection, disables their workflows in that channel, and posts a notice | `evict_live_channel_subscriptions`, `handlers/side_effects.rs:202` | Code |
| Cache | One membership set per user, at most 10 seconds old, up to 16,384 channels before falling back to point checks | `membership_cache.rs:19` | Code |
| Errors | A refused read never says whether the channel exists ("restricted: not a channel member"); an artifact id clash reveals only "taken" | `NIP-AR.md` Access | Spec and Code |
| Channel-limited keys | `AuthContext.channel_ids` is "reserved for future per-channel access control"; no code path sets it, and API tokens are only ever revoked | `buzz-auth/src/lib.rs:124`, `api/nip_fi.rs` | Code: not built |
| Several workspaces | Host name picks the community before any handler runs; unknown hosts fail closed; every query leads with `community_id` | `ARCHITECTURE.md` Step 0, `single_community.rs` | Code |
| Isolation proof | `docs/multi-tenant-relay.md` proves isolation assuming Postgres row-level security; the schema has no RLS policy, so isolation rests on every query passing `community_id` | `schema/` (no `CREATE POLICY`) | Spec ahead of code |
| Outside people | Same key can join another community, with a separate profile there. No channel is shared between communities | `VISION.md`, `docs/multi-tenant-conformance.md` | Code |
| Agents inviting | Any member who may post, agents included, may add members and turn a guest into a member ("a later restricted-agent level may limit it") | `buzz-core/src/channel.rs` | Code |
| Agent enumeration | Any member can list every agent, its owner and its allowlist | Issue #9528 | Open bug |

## 4. Agents

| Question | Answer | Where | Status |
|---|---|---|---|
| Join | A key, admitted as a workspace member or through its owner (NIP-AA), then added to channels like a person | `crates/buzz-acp/README.md`, identity doc | Code |
| Wake | `buzz-acp` subscribes to its channels; by default only mentions (`--subscribe mentions`), and only from its owner (`--respond-to owner-only`; also `allowlist`, `anyone`, `nobody`) | `crates/buzz-acp/src/config.rs` | Code |
| One at a time | At most one prompt in flight per channel; later mentions queue and are batched into one prompt; a pool of 1 to 32 agent processes | `queue.rs`, `pool.rs` | Code |
| Session scope | Default one session per channel (shared by its threads); thread-scoped sessions behind `--session-policy` | `crates/buzz-acp/src/scope.rs` | Code |
| What it sees | Base prompt (`base_prompt.md`), persona and team text, owner's memory (engrams), the triggering event and the last 12 messages of context (`BUZZ_ACP_CONTEXT_MESSAGE_LIMIT`) | `base_prompt.md`, `config.rs:390` | Code |
| How it posts | Runs `buzz messages send` itself; the bridge does not post final text. Tasks are `buzz issues create`, PRs `buzz pr open` | `base_prompt.md` | Code |
| Tool approvals | Every `session/request_permission` is answered `allow_once`, falling back to `reject_once`; a person is never asked | `crates/buzz-acp/src/acp.rs:2009` | Code |
| Agent mode | `--permission-mode` passes `default`, `acceptEdits`, `bypassPermissions`, `dontAsk` or `plan` to adapters that support it | `config.rs` | Code |
| Human checks | Creating an agent or a project channel opens an owner-reviewed draft the owner saves in desktop | `base_prompt.md` | Code |
| One-shot task | `buzz-acp run --task file.json`: one fresh process, one prompt, a JSON status line, exit. `taskId` is "correlation only, not a claim or deduplication key" | `crates/buzz-acp/TASKS.md` | Code |
| Remote | A backend program (`buzz-backend-<id>`) deploys the agent; presence is the only status; at most one live instance | `docs/remote-agents.md` | Spec and Code |
| Workflows | YAML, triggers `message_posted`, `reaction_added`, `schedule`, `webhook`. `request_approval` fails the run (WF-08); `send_dm` and `set_channel_topic` return not implemented | `crates/buzz-workflow/src/lib.rs:315`, `error.rs` | Code |
| Known holes | A message sent while the bridge is down is never delivered (#9853); no at-most-once reply fence, so a restart or duplicate bridge can answer twice (#6968); quota errors retried 25 minutes, then dropped silently (#9207); no way for admins to turn agents off per channel (#9538) | GitHub issues | Open |

## 5. Live delivery and catch-up

| Piece | Rule | Status |
|---|---|---|
| Subscribe | `REQ` with filters; live interest registered first, then stored events, then `EOSE` | Code |
| Limits | 64 KB frame, 1,024 subscriptions per connection, 500 stored events per filter, 1,024 handlers at once | Code (`handlers/req.rs:26`, `ARCHITECTURE.md`) |
| Paging | Channel and thread windows (NIP-CW) with relay-signed summary and bounds events | Spec and Code |
| Exact sync | For artifacts: `EOSE` means "the complete set at one cut" (one `REPEATABLE READ` snapshot); any lost live entry ends the sync with `CLOSED "resync: ..."`; the client replaces its copy only at `EOSE` and backs off with jitter (NIP-AR Sync rules 1 to 7) | Spec and Code |
| Slow clients | Send buffer full three times in a row closes the connection; for a sync one drop means resync | Code |
| Between pods | Redis pub/sub does not replay; a dropped event or a lagging worker sends `resync` to the affected syncs; a 30 second bound per delivery | Code (`multinode_fanout.rs`) |
| Reconnect | No resume token; a client reopens subscriptions with `since` (Inferred). The admission limit refuses a member's reconnect burst (#9502) | Code and open issue |
| Presence and typing | Redis keys with 180 s and 5 s windows; not stored | Code |

## 6. Git and code

| Piece | How | Status |
|---|---|---|
| Hosting | `git clone` and `git push` over smart HTTP on the relay; no filesystem: packs are create-only objects in S3, refs are one manifest swapped by conditional `PUT` (compare-and-swap); TLA+ and Lean models | Code (`crates/buzz-relay/src/api/git/`), Spec (`docs/git-on-object-storage.md`) |
| Who may push | The repo channel's roles: members write; `push:admin` narrows a protected branch to admins; `no-force-push`, `no-delete` | Code (`api/git/policy.rs`) |
| Signing | Commits signed with the Nostr key (NIP-GS); push credentials are NIP-98 | Code |
| Patches, PRs, issues | NIP-34 events; `buzz pr open`, `buzz issues create`, assignments as signed operations | Code |
| Projects | Kind 30621 groups repos with a home channel; tasks in a project channel land on its repo | Code (`buzz-cli/src/commands/project_channel.rs`) |
| "A branch is a room" | No code creates a channel per branch. `VISION_PROJECTS.md` marks project binding, the merge coordinator and NIP-34 issues as "Designed" | Claim |
| Review | A review is a signed event; required approvals and checks are "governance rules still to build" | Claim |

## 7. Deploy and scale

| Question | Answer | Status |
|---|---|---|
| One relay per workspace? | Either. Default: one host, one community. Multi-community: N stateless relay pods on one Postgres, Redis and S3, the host picks the community | Code |
| Ways to run | `deploy/compose` (Postgres, Redis, MinIO, optional Caddy), Helm chart with autoscaling, disruption budget and cron jobs for deletion and storage accounting, a Railway template | Code |
| Storage | Postgres for everything, events partitioned monthly; S3 for media and git | Code |
| Scale aids | Reader pool with a freshness fence, membership cache, 16 ordered fan-out workers, QUIC mesh between pods, Redis rate limits per key and per minute, LaunchDarkly caps | Code |
| What broke at size | A thread summary ran over the whole thread on every reply (63 TiB of temp spill on a 1.39M-reply thread, #7905); reactions read by an unbounded tag scan (#9850); 21 live sessions for one channel (#8738) | Open issues |
| Operations weight | Community deletion is a staged, leased, operator-approved job; schema changes go expand, deploy, backfill, contract | Code |
| Maturity | 1,793 open issues; the 1.0 upgrade lost most agents and custom configs for some users (#9544) | Open issues |

## 8. Gaps against its own claims

| Claim | Where | What the code shows |
|---|---|---|
| "Turn a feature branch into a room" | README, `VISION_PROJECTS.md` | Not built; marked Designed |
| "Let an agent triage a bug without giving it the keys to the kingdom" | README | The bridge approves every tool call; agents may add members and promote guests |
| Keys limited to channels | `api_tokens.channel_ids`, `AuthContext` | Reserved, never set |
| Tenant isolation proven | `docs/multi-tenant-relay.md` | Proof assumes row-level security the schema does not have |
| "Tamper-evident" audit log | README, `SECURITY.md` | Keyless chain (identity doc) |
| Workflow approvals | README "being wired up" | Still fail the run (WF-08) |
| "No rate limiting" | `ARCHITECTURE.md` section 9 | Out of date the other way: `RedisRateLimiter` is wired (`state.rs:1857`) |
| "No REST or event API for managing channel members" | `crates/buzz-acp/README.md` | Out of date: kind 9000 and 9001 do it |
| Desktop app | README | This repo's `desktop/` is the deprecated 0.X; 1.0 is elsewhere |

### Rows in `docs/phases/SPEC_COMPETITOR_PARITY.md` that this research contradicts

Not edited here (that file has uncommitted edits in the main checkout); for whoever owns it next.

| Row | Says | Should say |
|---|---|---|
| BZ product line | "one signed event log on a Nostr flockr" | "on a Nostr relay" (a find-and-replace slip) |
| P58 | BZ has keys limited to one channel | BZ has the field but does not enforce it; Flockr already does (`member_keys.channels`) |
| P71 | BZ messages can never be edited or deleted | BZ edits are new events (40003) and deletes set `deleted_at`; the signed original stays |
| P24, lessons | "Buzz has no tasks" | No board or claims, but typed records (`buzz.task` artifacts) and git issues with assignments |
| P25 | BZ: "a branch is a room" | Claim only; git hosting is real |

## What it means for Flockr

| Idea from Buzz | Verdict | Why | Lands in |
|---|---|---|---|
| One access check used on every write, history read, live delivery, search hit and catch-up | **Adopt** | Buzz's strongest part. Flockr's `visibleTo` (`apps/server/src/board/visibility.ts`) only hides DMs today; Phase 11 needs it to become `canSee(member, channel)` with org and channel membership | 11a: `visibility.ts`, every caller (`events.ts`, `search.ts`, `read.ts`, `focus.ts`, `navigation.ts`, `activity.ts`), the live hub |
| Check access again at each live delivery, not only when the socket subscribes | **Adopt** | A member removed mid-session must stop receiving at once; Buzz re-checks per recipient and evicts subscriptions on removal | 11a: `apps/server/src/live/hub.ts`, `runtime.ts` |
| On removal, cut the live stream for that channel and tell the client | **Adopt** | Buzz evicts subscriptions and posts a notice; Flockr's socket keeps a cursor per socket, so it can send a "channel gone" frame and drop that channel's events | 11a: live hub, `packages/contracts` live frames |
| A refused read never says whether the channel exists | **Adopt** | Cross-org boards leak by error text; return the same 404 for "not there" and "not yours" | 11a: `apps/server/src/board/errors.ts` |
| Search returns candidates, then each hit is re-checked | **Adopt** | Cheap safety net against a missed filter in SQL | 11a: `apps/server/src/board/search.ts` |
| A short-lived membership cache (10 s) with bulk checks | **Adapt** | Only if per-delivery checks get slow; Flockr is far below Buzz's size. Start without a cache | 11a, later |
| Channel-limited keys | **Keep ours** | Flockr already enforces `member_keys.channels` (`apps/server/src/board/keys.ts`); Buzz has not built it. Extend to org-limited keys | 11b Team keys |
| Hashed invite tokens with expiry, use limit and revoke | **Adopt** | Matches the Phase 11 invite need for client people; Buzz's `relay_invites` shape (hash, `max_uses`, required `expires_at`, `revoked_at`) is the right minimum | 11: invites for people (email) and agents |
| Read-only guest role per channel; a channel can make joiners guests | **Adopt** | Gives "client watches, does not post" without a new concept; one fixed list entry in `packages/contracts` | 11: shared channels, member roles |
| Agents may invite people and promote guests | **Reject** | An agent fenced to a client channel must never widen its audience; inviting stays a person's action or a question card | 11: fenced agent runs |
| Agent answers only its owner unless set otherwise | **Adapt** | In a shared channel, a client's mention should not wake our agent unless allowed. Add a per-agent "who may wake it": owner, owner's org, channel members | 11: fenced agent runs; `apps/runner` trigger rules |
| Auto-approve every tool call | **Reject** | Flockr's bridge turns unknown tools into question cards (`GUIDE_ARCHITECTURE_MODEL.md`, Permissions); keep it, more so for client channels | none |
| Agent list scoped by access | **Adopt** | Buzz's #9528 (anyone lists every agent and owner) is the bug to avoid; member and agent lists go through `canSee` | 11a: `apps/server/src/board/members.ts`, `agents.ts` |
| Tenant picked by host name, nothing shared across tenants | **Reject for Phase 11** | Phase 11 is orgs sharing one board and channels, which Buzz cannot do at all. Keep one board, org on every member, `canSee` across orgs | 11 spec (ADR with 11a) |
| `community_id` leads every key and query | **Keep ours** | `events` already keys on `(boardId, seq)`; if several boards ever share a database, the board id must lead every index and query | Platform, only if multi-board hosting |
| Order by signer time, catch-up by timestamp | **Reject** | Flockr's per-board `seq` with `since=N` is stronger: no clock window, no same-second ties, exact resume. Keep it | none |
| "Resync" instead of silent loss: the server ends a live stream it cannot keep exact, the client refetches from its cursor | **Adopt** | Flockr's `LiveSignals` (Postgres `NOTIFY`, Cloudflare later) can drop; a `resync` frame makes loss visible. Small: one frame type | Platform live adapters; `apps/server/src/live/hub.ts` |
| Messages lost while the agent bridge is down (#9853), double replies after restart (#6968) | **Keep ours** | The runner reads from `since=N` and claims carry a fence; both Buzz bugs are already ruled out by Flockr rules | none; worth a test in `apps/runner` |
| Typed records with compare-and-set on the previous version | **Adapt** | For the living document per channel (P99) and any shared note: an edit names the version it replaces, a stale edit is refused, retry is safe | 11: living document per channel |
| Whole-document canvas where an untagged write wins | **Reject** | Lost updates between two agents; use the compare-and-set above | 11: living document |
| Edits as new events, deletes as tombstones | **Keep ours** | Same as Flockr's `message.edited` and `message.deleted` | none |
| Git hosting inside the board, on object storage | **Reject** | Flockr pushes `flockr/<task>` to GitHub (Phase 8); hosting git is a large product of its own, and Buzz backs it with formal proofs | none |
| "A branch is a room" | **Keep ours** | Buzz has not built it; Flockr already ties a task, its thread and its branch | Phase 11 shared threads with their branch |
| Owner-reviewed drafts: an agent proposes a new agent or channel, the owner saves it | **Adopt** | Fits "nothing acts unless asked"; a draft is a question card with a form | Phase 11 or Phase 3 agent creation |
| Agent memory and turn cost encrypted to the owner | **Adapt** | For shared channels, an agent's memory notes and cost must not show to the client org; `canSee` on `memory_items`, no crypto | 11a: `apps/server/src/board/memory.ts` |
| One-shot task run from a file, JSON status line, no claim | **Reject** | Flockr's claim-renew-submit loop is the point of the board; a one-shot runner without a claim is a step back | none |
| Remote agent backends, presence as the only status | **Adapt** | 4c Cloud agents: one live instance per agent and "presence is status" match Durable Objects; take the at-most-one rule, not the plug-in binary contract | 4c, `apps/server/src/platform/cloudflare/` |
| YAML workflows | **Reject** | Approval steps still fail in Buzz; Flockr's routines (5b) already run with limits | none |
| Slack bridge | **Nothing to take** | Buzz has none; its webhook trigger with a secret and outbound calls behind an SSRF check are the only integration pattern. For 5d, copy the SSRF check on outbound calls | 5d Slack sync |
| Signed events and owner attestation | See identity doc | 3f now, 3g signed writes before Phase 11 ships, if wanted | 3f, 3g |

### For the Phase 11 spec, in one list

1. `canSee(member, channel)` is the only gate, used by every read, every live delivery, catch-up, search and the member list.
2. Removal takes effect at once: the live hub re-checks and drops that channel's events, then sends a frame saying so.
3. A refused read looks the same as a missing one.
4. Roles per channel: `member` and `guest` (reads only), from one list in `packages/contracts`.
5. Invites: hashed token, expiry required, use limit, revoke; people by email, agents by a channel-limited key (already built).
6. Agents fenced to a channel: who may wake them is a setting, they cannot invite, their memory stays with their org.
7. Keep `seq`; add a `resync` frame for lost live delivery.

## Things I did not confirm

- Desktop 1.0 (`block/buzz-app`) was not read; anything about the current desktop is from the deprecated 0.X code or docs.
- Whether a reconnecting client dedupes by id, and the exact `since` overlap it uses, was not traced.
- Artifact reads and the sync path were read through the NIP and test names; only the write check in `buzz-db/src/store/artifact.rs` was read in code.
- Nothing was built or run; no relay was started.
