# 0029: A direct message is a private channel of kind dm

Status: accepted, 25 Nov 2026. Work: 2g-slack-navigation. Its `direct_members` table and the live socket without identity are superseded by 0033.

## Problem

Sub-phase 2g needs private conversations between two members (person and person, or person and agent). Everything that reads or writes messages (feed, threads, tasks, search, events, drafts) is keyed by channel id.

## Options

| Option | Good | Cost |
|---|---|---|
| A separate `conversations` table with its own messages | Privacy is structural | Every feature (threads, replies, tasks, activity entries, the runner) is built twice |
| A channel with `kind = 'dm'` plus a `direct_members` table (two rows) | Threads, replies, labels, tasks, activity and the runner work unchanged | Every read path must check membership |

## Choice

A DM is a row in `channels` with `kind = 'dm'`, an id `dm-<a>-<b>` (names sorted), and two rows in `direct_members`. `POST /api/dms` opens one or returns the existing one. Access is enforced in three places:

1. One guard in the request middleware (`requireDirectAccess`) resolves the channel of any request that names a channel, thread, task or message and refuses a non-member (403). Keys limited to channels are already refused, since a DM is never in a key's list.
2. Listings that span channels take the viewer and hide others' DMs through one SQL helper, `visibleTo` (channels, tasks, inbox, search, activity, agent activity, the member's own `/api/me/*` lists, `GET /api/events`). The brief hides every DM.
3. The live socket has no member identity, so it redacts DM events to routing fields (`mentions`, `direct`, `member`, `state`) instead of filtering them.

A DM with an agent wakes it with no runner-side channel knowledge: the server adds the other member to the `mentions` of every message and reply posted in a DM and marks the event `data.direct = true`. The runner already starts a conversation on a top-level message that mentions it; for replies it now also converses when `direct` is set and it is mentioned (`addressedDirectly` in `apps/runner/src/routing.ts`).

## Why

One model for conversations means 2g adds no second code path to keep in step. Putting the address in `mentions` keeps the runner free of channel kinds.

## Costs

- Any new route that lists across channels must call `visibleTo` or it leaks DMs; the backend checklist should say so.
- The live socket still tells every client that something happened in a DM (channel id, actor, message id), never what.
- `GET /api/events` drops DM events for non-members, so a page can be shorter than `limit` without being the last.
- Each top-level DM message is its own thread, so the agent answers in that message's thread.
