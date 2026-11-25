# 6b Search

Phase 6, row 6b in the [master checklist](../SPEC_MASTER_CHECKLIST.md); parity P15 (full-text search). Postgres full-text search, a plain Postgres feature, so the data layer stays portable ([ADR 0006](../../decisions/0006-postgres-is-the-data-store.md), [ADR 0017](../../decisions/0017-flockr-runs-on-cloudflare-through-platform-adapters.md)).

## Problem

⌘K only filtered the channels, tasks and agents the web app had already loaded. Nobody, person or agent, could find a message or a task by a word in it. Example: "where did we talk about rate limiting?" had no answer short of reading every channel.

## Scope

- **Schema** (`apps/server/drizzle/0006_search.sql`): two GIN expression indexes, no new column.
  - `messages_search` on `to_tsvector('english', body)`, partial: `kind = 'text' and deleted_at is null`, so deleted messages are not even in the index.
  - `tasks_search` on the title (weight A) plus the spec (weight B).
  - The expressions live once in `apps/server/src/db/schema.ts` (`messageSearchVector`, `taskSearchVector`), used by both the index and the query, so the planner always picks the index.
- **Route:** `GET /api/search?q=&channel=&limit=` (`searchBoard`), logic in `apps/server/src/board/search.ts`, schemas in `packages/contracts/src/search.ts`. It returns `{ query, hits }`; a hit is a `message` (id, channel, `threadId` to open, `taskId` when it is a reply in a task thread, who, at) or a `task` (id, channel, title, state, who made it, at). Each carries a `snippet` as parts `{ text, match }` and a `rank`. An unknown channel is a 404; `limit` defaults to 20, at most 50.
- **Matching:** every word must match (English stemming), and the last word also matches as a prefix in both English and simple form, so results come while typing: `flaming` finds "flamingo", `limi` finds "limiting".
- **Ranking:** `ts_rank_cd` normalised to below 1, plus 1 when the whole query appears as typed, so an exact phrase always ranks first; ties go to the newer item.
- **Surfaces:** the route; the generated client and MCP tool (`bun run generate`); `flockr search <text> [--channel c] [--json]` (exit 2 when nothing matches); ⌘K's "Search messages and tasks" section, debounced by 200 ms, opening the message's thread, the task thread a reply lives in, or the task.

**Out:** searching question cards, activity entries and system events; search across several boards (one board today); filtering by author or date; a search screen beyond ⌘K.

## Rules the tests hold (`apps/server/test/search.test.ts`)

- One word finds a message, a reply and a task, each with the word marked in its snippet; a prefix finds them too.
- The exact phrase ranks above the same words scattered.
- The channel filter keeps hits to one channel; an unknown channel is a 404.
- A deleted message is never found, and its text never comes back.

## Exit checklist

- [x] Migration written by `bun run db:generate`; both indexes used (checked with `EXPLAIN`).
- [x] Route, generated client and MCP tool, `flockr search`, ⌘K section.
- [x] Board skill lists `flockr search`.
- [x] `bun run check` passes (server 60, runner 96, web 6).
- [x] Checked on a running build: CLI hits with marked words, ⌘K results open the thread (`?thread=m33`) and the task (`?task=818`).

## Notes from the build

- A GIN index on an expression that is not a single function call needs its own parentheses (`USING gin ((a || b))`); drizzle-kit writes what the schema gives it, so `taskSearchVector` wraps itself.
- Inside a single-table select, drizzle renders `${tasks.id}` as a bare `"id"`, which a correlated subquery resolves to its own table. The "who made the task" subquery names `"tasks"."id"` in full.
- A prefix on a stemmed word misses (`flaming` stems to `flame`), so the last word is matched as `english:* | simple:*`.
- The snippet comes from `ts_headline` with control characters as markers, split into parts on the server, so neither the CLI nor the web app parses markup and a message containing `**` or `<b>` cannot fake a highlight.
- cmdk filters items by their value on the client; each server hit carries the typed text as a keyword so it is never filtered out. A task can appear both under Tasks (loaded list) and under Search; left as is.
- A path such as `/users` is one token to the Postgres parser, so "users" does not find "Build the /users API". Fine for now; a custom parser config is the fix if it matters.
