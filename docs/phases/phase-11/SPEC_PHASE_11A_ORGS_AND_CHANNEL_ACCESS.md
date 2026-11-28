# 11a Orgs and channel access

Row 11a in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 11 README](README.md); the model is [ADR 0033](../../decisions/0033-orgs-are-tenants-on-one-board-and-one-cansee-rule-guards-every-read.md). Covers P58 for orgs (keys limited to channels already exist, 3c).

## Problem

Example: our org runs `#backend` and `#billing`. We share `#acme-site` with the client org `acme`, whose person `ana` and agent `acme-bot` join it. `ana` must see `#acme-site` and nothing else: no `#backend` messages, tasks or search hits, no `globex` member names, no events from other channels on the live socket or in its catch-up.

## Scope

- **Schema** (`apps/server/src/db/schema.ts`):
  - `orgs`: `id` (slug), `name`, `host` (exactly one row is the host org, a partial unique index), `created_at`. The migration adds the host org `home`.
  - `members.org`: not null, references `orgs`, default `home`. Fixed when the member is made.
  - `channels.org` (the owning org, default `home`) and `channels.visibility`: `org` (everyone in the owning org, the default), `private` (only its listed members), `shared` (everyone in the owning org plus listed members of other orgs).
  - `channel_members` (`channel`, `member`, `added_by`, `added_at`) replaces `direct_members`: the migration copies every DM pair and sets every DM to `private`.
- **The rule, `canSee(viewer, channel)`** (`apps/server/src/board/visibility.ts`), one SQL helper and its single-channel check:
  - `viewer` is the acting member plus the key's channel limit, when there is one.
  - A viewer sees a channel when it is listed in `channel_members`, or the channel is not `private` and the viewer's org owns it; and, with a limited key, the channel is in the key's list.
  - Board-wide rows with no channel (machines, agents, routines, keys, board-wide events) belong to the host org.
  - Never branches on member kind or channel kind.
- **Where it holds:**
  - The request guard (`apps/server/src/auth/scope.ts`) resolves the channel of every route that names a channel, thread, task, message or plan and refuses one the viewer cannot see (403). Board-wide routes are refused to members of a client org, except the ones that filter by the viewer: events, Focus, inbox, activity, `/api/me/*`, direct messages.
  - Every list across channels filters with the same helper: channels, members, orgs, tasks, claim-next, plans, search, Focus, inbox, activity, agent activity, saved, sent, threads, drafts, events, the brief.
  - The live socket knows its viewer: each socket keeps its member and key limit, and catch-up from `since=N` and every live event go through `eventsSince` for that viewer. A private channel of the viewer's own org it cannot see still arrives as a routing stub, as DMs did (ADR 0029); another org's events never arrive. Activity frames go only to viewers who can see the channel; agent frames only to the host org.
  - A channel-limited key may now open the live feed; it receives only its channels.
  - MCP and `flockr` call the same routes, so they inherit the rule.
- **Who can see a member:** a member of the same org, or one who can see a channel the member can see.
- **Writes that name a member** check the rule: a mention resolves only to members who can see the channel; a task is given, handed off or assigned only to a member who can see its channel; a DM opens only with a member the actor can see; an agent's owner is in the agent's org.
- **Sharing:** our org shares. A channel's visibility is set at creation or with `updateChannel`; members are added and removed with `addChannelMember` and `removeChannelMember`. A member of another org joins only a `shared` channel, and only a member of the owning org adds or removes anyone. A channel with outside members cannot leave `shared` until they are removed. A DM's members and visibility never change.
- **Out:** the wait tool and outside agents connecting (11b); invites and profiles (11c); fencing agent runs (11d); org owners, a client org's own channels and self-invites (11f).

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `listOrgs` and `createOrg` on `/api/orgs`; `createMember` takes `org`; `createChannel` and `updateChannel` take `visibility`; `listChannelMembers`, `addChannelMember`, `removeChannelMember` on `/api/channels/{channel}/members[/{name}]`; `Member`, `Channel` and `/api/me` show the org |
| `flockr` | `orgs [list]`, `orgs create <id> <name>`; `join --org <id>`; `channels create --visibility v`, `channels share\|unshare <channel>`; `channels members <channel>`, `channels add\|remove <channel> <member>` |
| Web app | Channel settings: visibility and members (add, remove); the org shown beside members from another org in the member list |

## Rules the tests hold

`apps/server/test/orgs.test.ts`, with the host org, a client org `acme` and a second client `globex`:

- `ana` (acme) sees only `#acme-site`: channels, members, orgs, messages, threads, tasks, getTask, claim-next, plans, search, Focus, inbox, activity, channel memory, events and agent runs; a route naming `#backend` or one of its tasks, messages or plans is 403.
- Board-wide routes (agents and their notes and saved sessions, machines, keys, routines, approval rules, brief) are 403 for a client org.
- The live socket for `ana` gets `#acme-site` events only, live and in catch-up from `since=0`; the host gets a stub for a private channel it is not in; a limited key's socket gets only its channels.
- MCP `listTasks` and `searchBoard` called with `ana`'s identity return only `#acme-site`.
- A mention of a `globex` member in `#acme-site` resolves to nothing; giving a task to them is refused; adding them to an `org` channel is refused; removing the last outside member lets the channel leave `shared`.
- DMs keep working after the move to `channel_members` (the existing DM tests).

## Exit checklist

- [x] Schema, migration with the DM copy, board functions, routes, regenerated client and MCP tools
- [x] The guard and every list use `canSee`; the live socket per viewer on Bun, the dev server and the Worker
- [x] `flockr orgs`, `flockr channels` sharing commands
- [x] Web: channel visibility and members; org shown on outside members
- [x] Tests above; `bun run check`
- [x] ADR 0033, the backend checklist line, the board skill, the master checklist and parity rows

## Notes from the build

Small choices made here, all reversible:

- The host org's id is `home` (`hostOrg` in `packages/contracts/src/constants.ts`), written by migration `0019_orgs_and_channel_members.sql`, which also copies every DM pair into `channel_members`; `0020_drop_direct_members.sql` drops the old table. Restore treats `orgs` as written by migrations and replaces its row (`apps/server/src/backup/backup.ts`).
- `Viewer` is the acting member plus the key's channel limit, set once in the request middleware as `c.var.viewer`; every list takes it, so a limited key's lists narrow to its channels (before, it saw every channel's name).
- A route naming a channel the viewer cannot see is 403 when the channel exists and goes on to the route's own 404 when it does not. The status tells a guesser that a channel name exists; nothing else leaks. Make both 404 if that matters.
- Members a viewer sees: the same org (not with a limited key), themselves, and anyone who sees a channel they see. A client member sees every host member, since host members see the shared channel.
- Board-wide rows and events (no channel) belong to the host org; client members get 403 on board-wide routes except the viewer-filtered ones (events, Focus, inbox, activity, `/api/me/*`, DMs, joining).
- `createMember` with an actor from a client org is refused; an unknown actor (sign-in off, first `flockr join`) may still add members, as before.
- The brief and its inbox section read with an audience: posted in channel C it includes only C, or every non-private channel of C's org when C is an `org` channel (`seenByAll`), so a brief posted in a shared channel never lists other channels.
- The live socket now has identity: Bun and the dev server identify on upgrade; the Worker identifies and passes the viewer to the Durable Object in `x-flockr-live-viewer`, kept in each socket's attachment. With sign-in off the viewer is `?as=`, the member header or the default member. DM events now arrive in full to their members; a private channel of the viewer's own org it cannot see arrives as a routing stub; nothing of another org arrives.
- Activity frames are checked per socket with `canSee` and agent frames go to host members only: one query per socket per frame, fine at today's socket counts.
- The web app shows a member's org beside their name when it differs from yours, and a visibility button in the channel header opens the sharing dialog.
