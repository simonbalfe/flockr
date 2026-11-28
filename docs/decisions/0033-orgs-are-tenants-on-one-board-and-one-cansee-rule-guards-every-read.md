# 0033: Orgs are tenants on one board, and one canSee rule guards every read

Status: accepted, 28 Nov 2026. Work: 11a-orgs-and-channel-access. Extends 0029 (DMs become private channels with listed members).

## Problem

Phase 11 lets client orgs' people and agents work with ours in shared channels (Simon, 28 Nov 2026). Nothing about one org may reach another: no message, task, member name, search hit or event. Before this, every member saw every channel except DMs, and the live socket sent every event to every client.

## Options

| Option | Good | Cost |
|---|---|---|
| A board per tenant, a shared channel copied between boards | Isolation is structural | Two event logs to keep in step; a task claimed on one board is not fenced on the other; every feature learns about copies |
| One board; an org on every member and channel; listed channel members; one rule checked on every read | One event log, claims and fences unchanged; a shared channel is an ordinary channel | Every read path must use the rule, and a missed one leaks |
| Row-level security in Postgres | The database refuses a missed path | A session variable per request through Hyperdrive and the Worker; harder to test and to explain an error |

## Choice

One board. Orgs are the tenants; the host org (`home`) runs the board.

- `orgs`; `members.org`; `channels.org` and `channels.visibility` (`org`, `private`, `shared`); `channel_members` replaces `direct_members`.
- **canSee(viewer, channel):** the viewer is listed in the channel's members, or the channel is not private and the viewer's org owns it; a key's channel limit narrows it further. It never branches on member kind or channel kind. Rows with no channel are board-wide and belong to the host org.
- It is enforced in the three places ADR 0029 named: the request guard for anything naming a channel, thread, task, message or plan; one SQL helper in every list; and the live socket, which now knows each socket's viewer and filters events, catch-up and frames with the same helper.
- Writes that name a member (mentions, assignees, hand-offs, DMs, agent owners) only name members who can see the channel.

## Why

The board's rules (claims, fences, the event order) live in one transaction on one log; splitting the log for tenancy would break the guarantees the board exists for. The DM work already put every read behind two helpers, so widening their rule is a small change with one place to test. Row-level security stays an option if a leak is ever found: the helper is the policy it would encode.

## Costs

- A new list or route must use the helper; the backend checklist says so and `orgs.test.ts` covers every read path named in the spec.
- The live socket checks visibility per viewer instead of once per event.
- Board-wide pages (agents, machines, routines, keys) are host-only until a client org has an owner (11b).
- A member's org is fixed when it is made; moving one means a new member.
