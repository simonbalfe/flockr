# Phase 10: Agent memory (10a notes, 10b channel memory)

Rows 10a and 10b in the [master checklist](../SPEC_MASTER_CHECKLIST.md); parity P26, P41, P75. Why and the options: [ADR 0026](../../decisions/0026-agent-notes-and-channel-memory-are-postgres-items-the-runner-injects.md). Done when an agent uses a decision from last week's thread without being told it again.

## Problem

Example: on Monday in #backend someone decides "Primary keys are uuid" in thread m12. On Friday a new conversation with `@claude` asks for a users table. Without memory claude asks again or guesses. With memory, the decision is in claude's first prompt.

## Scope

- **Schema** (`apps/server/src/db/schema.ts`, `memory_items`): id, `scope` (`agent` or `channel`), `owner` (agent name or channel id), `kind`, `text`, `tags`, `source_thread`, `key`, `created_by`, `updated_by`, `created_at`, `updated_at`, `archived_at`; checks from the contract lists; a partial unique index on `(scope, owner, key)`.
- **Kinds** (`memoryKinds`): `dead-end`, `decision`, `preference`, `fact`, `todo`. Text is at most 500 characters, at most 5 tags, 100 live items per agent and per channel (`memoryLimits`).
- **Rules** (`apps/server/src/board/memory.ts`, `packages/contracts/src/memory.ts`):
  - Agent notes: that agent and any person read, add, edit, archive and restore; another agent is refused (403); an unknown or non-agent name is 404.
  - Channel memory: any member reads and adds; a person changes any item; an agent only the items it added.
  - An add with a `key` used before returns the existing item and writes nothing; adds run under an advisory lock so the cap and the key hold at once.
  - An edit that changes nothing, a repeat archive and a repeat restore write no event. An archived item cannot be edited until restored.
  - Every change is an event in the same transaction: `memory.added`, `memory.updated` (with `changed`), `memory.archived`, `memory.restored`; channel events carry the channel.
- **Access with sign-in on:** a key acts as its member. Channel memory routes sit under `/api/channels/{channel}/...`, so the existing scope rule limits a channel-limited key to its channels; agent notes sit under `/api/agents/...`, which a channel-limited key cannot reach.

## Surfaces

| Surface | Agent notes (10a) | Channel memory (10b) |
|---|---|---|
| API / MCP operationIds | `listAgentNotes`, `addAgentNote`, `updateAgentNote`, `archiveAgentNote`, `restoreAgentNote` on `/api/agents/{name}/notes[/{id}[/archive\|restore]]` | `listChannelMemory`, `addChannelMemory`, `updateChannelMemory`, `archiveChannelMemory`, `restoreChannelMemory` on `/api/channels/{channel}/memory[/{id}[/archive\|restore]]` |
| `flockr` | `notes [list] [--agent a] [--archived]`, `notes add <text> [--kind k] [--tag t]... [--thread id] [--key k]`, `notes edit <id> [text] ...`, `notes archive\|restore <id>` | the same words under `memory ... --channel <c>` |
| Web app | Agent panel, "Notes": add, edit, archive, restore, archived tab | Channel header "Memory" opens a panel with the same list |
| Runner | Reads the agent's active notes when a conversation or task run starts and puts them in the first prompt | Same for the channel's memory, placed before the notes; the instructions tell the agent when and how to save |

The list routes page with `limit` and `before` (id, newest first); active items are capped below the page size so the runner always reads them all.

## Rules the tests hold

- `apps/server/test/memory.test.ts`: an agent reads and writes only its own notes and a person any; the same key added twice, concurrently, keeps one item and one event; edits, archives and restores are events and repeats and no-op edits write none; the live cap holds until one is archived; channel memory edit rights (agent only its own); notes and channel memory never mix; with sign-in on, a channel-limited key reaches only its channels' memory and no notes.
- `apps/runner/test/runner.test.ts`: a new conversation and a work prompt carry channel memory then notes (dead ends and decisions first) at the top; a resumed one does not repeat them; the block stays inside its cap and says how many it left out; a board that cannot answer does not stop the run.

## Exit checklist

- [x] Table, migration, board functions, routes, regenerated client and MCP tools
- [x] `flockr notes` and `flockr memory`
- [x] Web: agent panel Notes, channel Memory panel
- [x] Runner injects both blocks within the cap; instructions say when to save
- [x] Board skill, runner README, web README, ADR 0026, checklist and parity rows
- [x] `bun run check` and `bun run build`

## Notes from the build

Small choices made here, all reversible:

- One table with a scope column instead of two tables; `owner` has no foreign key and is checked on write.
- Agents may add channel memory without approval and may edit or archive only what they added; people hold the rest. Every change is an event, so a person can see and undo it.
- Archive and restore instead of delete, so nothing is erased (competitor research: notes are superseded, not deleted). Dead ends are a kind and sort first in the prompt. There is no explicit supersede link yet; a replacement is an add plus an archive.
- Limits: 500 characters, 5 tags, 100 live items, 3000 characters per prompt block.
- Selection into the prompt is by kind then recency, not search relevance. A resumed session is not given the block again (it can run `flockr notes list`).
- Agent notes are private to the agent and to every person, not only its owner; people share the board.
- The migration is `0014_agent_notes_and_channel_memory.sql`; other builders add migrations in parallel, so the lead regenerates it at merge. `resetBoard` in `apps/server/src/seed/seed.ts` truncates `memory_items`.
