# 13e Read cursors and backlog

Row 13e in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P101.

## Problem

Example: Simon posts the new plan in `#acme-site` and asks codex and `acme-bot` to read it. Each member's `reads.last_read_id` exists, but only its owner sees it (as unread counts), so Simon cannot tell that `acme-bot` stopped reading two hours ago with 9 items behind, and PL12's stuck flag has nothing to read.

## Scope

- **Who is behind:** `listChannelReaders` (`GET /api/channels/{channel}/readers`) lists every person and agent who can see the channel, from any org (`memberSees`), with `lastReadId` (`m12`, or null before their first read), `readAt`, `backlog` (feed items after their cursor written by someone else, the same count as `unread`) and `behindSince` (when the oldest of those was posted; null when up to date). Most behind first. Anyone who can see the channel may read it; the request guard checks `canSee`.
- **Schema:** `reads.read_at` timestamptz null (migration `0026_read_cursors`), set on every move.
- **Move the cursor as far as you read:** `markRead` takes `?upTo=m12`: the cursor moves to the last feed item at or before that message (a reply or task-thread entry counts as the feed position before it). It never moves back; a repeat changes nothing. Without `upTo` it moves to the newest item, as before.
- **Who moves it:** the web app as today; `flockr read <channel>` moves it to the last item it printed; the runner moves the agent's cursor to the message that started a conversation. `channel.read` events (`lastReadId`, `upTo`) carry the channel, so the live feed shows them only to viewers who can see it.
- **For PL12:** `behindSince` is the field the stuck flag reads ("behind at the same cursor for 10 minutes").
- **Out:** per-thread cursors, read receipts on single messages, notifications about readers.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `listChannelReaders`; `markRead ?upTo=` |
| `flockr` | `readers <channel>`; `read <channel>` moves your cursor; `mark-read <channel> [--up-to m12]` |
| Web app | A Readers button in the channel header lists each member with "up to date" or "9 behind since 10:40" |
| Runner | Marks read up to the message that woke the agent |
| Board skill | Your cursor shows to everyone in the channel; read the channel with `flockr read` |

## Rules the tests hold

`apps/server/test/readers.test.ts`:

- In `#acme-site`, simon, ana (acme person), `acme-bot` and our agents are listed; `gus` (globex) is not, and `gus` gets 403.
- After simon posts twice, `acme-bot` shows backlog 2 with `behindSince` at the first post; after `markRead?upTo=` the first, backlog 1; after a plain `markRead`, 0 and `behindSince` null.
- `markRead?upTo=` an older message never moves the cursor back, and a repeat writes no event.
- `acme-bot` reads `#acme-site`'s readers; it gets 403 on `#backend`'s.

## Exit checklist

- [x] Column and migration, `listChannelReaders`, `markRead ?upTo=`
- [x] `bun run generate`, MCP, `flockr readers`, `flockr read` moves the cursor, `flockr mark-read`
- [x] Web Readers list; runner marks read
- [x] Tests above; `bun run check`
- [x] Board skill, master checklist row, parity row P101 (where it exists)

## Notes from the build

- `markRead` already never moved back and wrote nothing on a repeat; `upTo` only caps the target with `id <= upTo`, which also places a reply or a task-thread entry at the feed item before it.
- The runner moves the cursor only for message threads (a mention or a reply in `m12`); a task thread has no single feed item to read up to, so a run on a task leaves the cursor alone. Its failure is logged and never stops a run.
- Rows read before the migration have no `read_at`; they show the cursor without a time until it next moves.
- P101 lives only in the main checkout's uncommitted parity edits; its status there is for the coordinating session to set.
