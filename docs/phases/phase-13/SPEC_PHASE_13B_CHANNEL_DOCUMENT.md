# 13b Channel document

Row 13b in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P99, P14, P121 and P129.

## Problem

Example: in `#backend` the current plan for the users API ("table first, then the migration, then the API; sign-up waits for the email plan") lives in a reply from Monday, two memory items and Simon's head. codex, woken to review #812, cannot find it. When claude and simon both rewrite a shared plan at once, the last save silently wins.

## Scope

- **One document per channel**, plain Markdown, at most `documentLimits.chars` (20,000) characters. Every channel has one; before the first edit it is version 0 and empty.
- **Schema** (`apps/server/src/db/schema.ts`, migration `0023_channel_documents`): `channel_document_versions` (`channel` references `channels.id`, `version` integer, `body` text, `note` text null, `written_by` references `members.name`, `written_at` timestamptz; primary key `channel, version`). Append-only: the current document is the highest version, and no row is ever updated or deleted.
- **Edit names the version it replaces:** `editChannelDocument` takes `{ text, replaces, note? }`. It locks the channel row, and when `replaces` is not the current version it is refused with 409 `stale_version` ("#backend's document is at version 4 (simon, 10:40); read it and edit again"). So two edits never both win (P121).
- **Repeat-safe:** a retry of the edit that made the current version (same member, same text, `replaces` one below) returns that version and writes nothing; an edit that changes nothing returns the current version.
- **Who:** anyone who can see the channel reads and edits it, people and agents, from any org (the request guard checks `canSee` on `/api/channels/{channel}/...`). Nothing crosses orgs: the event carries its channel.
- **Every version readable:** `getChannelDocument` takes `?version=N`; `listDocumentVersions` lists every version newest first with who, when, note and size.
- **Agents read it first:** the runner puts the document at the top of every run's prompt (work, conversation, review), above the channel memory, cut at `documentLimits.promptChars` (6,000) with a pointer to `flockr doc show`. The board skill says to read it before starting and to update it when the plan changes.
- **Event:** `channel.document_edited` (`version`, `replaces`, `note`).
- **Out:** rich text or blocks (13c types messages, not the document), comments on a line, more than one document per channel, merging two edits (the second editor reads and edits again), search over the document.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `getChannelDocument` (`GET /api/channels/{channel}/document?version=`), `editChannelDocument` (`PUT`, `{ text, replaces, note? }`), `listDocumentVersions` (`GET .../document/versions`) |
| `flockr` | `doc show <channel> [--version n]`, `doc edit <channel> --replaces n (--file path \| --text t) [--note why]`, `doc versions <channel>` |
| Web app | A Doc button in the channel header opens the document; Edit opens a text area and saves against the version shown; on `stale_version` it says who edited it and shows the newer text; a version list shows any earlier one |
| Board skill | Read the channel document first; update it when the plan changes, naming the version you read |
| Runner | The document heads every prompt |

## Rules the tests hold

`apps/server/test/documents.test.ts`:

- A new channel's document is version 0 and empty; simon writes version 1 replacing 0.
- claude and codex both edit replacing 1: exactly one gets version 2, the other 409 `stale_version`, run in parallel.
- Retrying the same edit returns version 2 and the log holds one `channel.document_edited` for it.
- Version 1 stays readable with `?version=1`; versions list newest first.
- `acme-bot` reads and edits `#acme-site`'s document and gets 403 on `#backend`'s.
- Text over the limit is refused (400).
- `apps/runner/test/units.test.ts`: the memory block starts with the document and cuts it at the prompt limit.

## Exit checklist

- [x] Schema and migration, `documentLimits`, `stale_version`, the locked edit, the event
- [x] Routes, `bun run generate`, MCP tools, `flockr doc`
- [x] Web: Doc button, view, edit with stale handling, versions
- [x] Runner prompt; board skill
- [x] Tests above; `bun run check`
- [x] Master checklist row, parity rows P14, P121, P129 (P99 where it exists)

## Notes from the build

- The document is one append-only table of versions; the current one is the highest version, so there is no row to update and the log and the table cannot disagree. An edit locks the channel row (`for no key update`), which is what makes the parallel test give one winner.
- An edit with the current text writes nothing, and an empty first edit keeps version 0: a version is only made when the text changes.
- The runner fetches the document with the memory in one call (`board.memory`); a board that cannot answer still starts the run without it, as with memory.
- The web dialog keeps the draft when the edit is stale and shows the newer version inside the notice; "Save over version N" re-aims the draft at it. It never merges.
- P99 lives only in the main checkout's uncommitted parity edits, so its status there is for the coordinating session to set; P14, P121 and P129 are set here.
