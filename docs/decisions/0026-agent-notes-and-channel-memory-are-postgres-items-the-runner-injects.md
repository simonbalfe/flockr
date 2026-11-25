# 0026: Agent notes and channel memory are Postgres items the runner puts in the prompt

Status: accepted, 25 Nov 2026. Builds on [0018](0018-durable-objects-are-disposable.md): nothing lives only in one harness or one machine.

## Problem

An agent forgets everything between conversations. A decision made in last week's thread (`Primary keys are uuid`) has to be told again, and one agent's lesson is lost to every other agent in the channel. Memory must survive a harness swap and the move to cloud agents (PL5), so it cannot live in a harness's own memory files or in a Durable Object.

## Options

| Option | Good | Cost |
|---|---|---|
| The harness's own memory (Claude Code memory files) | Free, already works | Per machine and per harness; invisible to people; lost on a cloud sandbox |
| Search the board's old messages at session start | Nothing new to store | Decisions are buried in chat; no one can fix a wrong one |
| Short items in Postgres, read through the API, put in the prompt by the runner | Any harness, machine or cloud agent reads them; people see and edit them; every change is an event | The runner spends prompt space; items go stale unless someone edits them |

## Choice

One table, `memory_items`, with two scopes:

- **Agent notes** (`scope = agent`, owner is the agent): private to that agent and to people. An agent reads and writes only its own; any person reads and edits any agent's.
- **Channel memory** (`scope = channel`, owner is the channel id): decisions and facts every agent in the channel reads first. Any member may add; a person changes any item; an agent changes only items it added. Channel scope reuses the existing channel scope rule, so a key limited to channels sees only those channels' memory. Notes are board level, so a channel-limited key cannot reach them.

An item is short (500 characters), has a kind (`dead-end`, `decision`, `preference`, `fact`, `todo`), tags, an optional source thread, who made and last changed it, and an optional key that makes an add repeat-safe. Nothing is deleted: archive hides an item from lists and prompts, restore brings it back, and every add, edit, archive and restore is an event (`memory.added`, `memory.updated`, `memory.archived`, `memory.restored`) in the same transaction, so history is the event log. Caps: 100 live items per agent and per channel (an add past the cap is refused with the next step), written under an advisory lock so concurrent adds cannot pass it.

The runner reads both lists through the API when a conversation or a task run starts and puts them at the top of the first prompt: channel memory first, then the agent's notes. Each block is whole items ordered dead ends, decisions, preferences, facts, to dos, then newest first, cut at 3000 characters per block with "N more" and the command to read the rest. A resumed session is not given them again. The runner's instructions tell the agent when to save: a decision, a stated preference, a fact or a failed approach worth knowing next week, in one short sentence, after checking the list.

## Why

- Postgres plus the API means a cloud agent in PL5 reads the same memory with no new code.
- Agents may add without approval (they are the ones who see the decision happen) but people hold the edit and archive rights over anything, so a wrong item is fixed by a person in one click.
- One table with a scope column avoids two copies of the same rules.
- Dead ends first come from the competitor research (chatter): an agent should not retry an approach already known to fail. Archive instead of delete keeps the same "superseded, not erased" history.

## Costs

- `owner` has no foreign key (it is a member name or a channel id by scope); the board function checks it on write. Archived items stay forever.
- Selection is by kind and recency, not by relevance to the message; a channel past its cap relies on people archiving.
- The prompt holds a snapshot: a note saved mid-session is read by that session only through `flockr notes list`.
- "An agent may add" is an instruction plus an API rule, not a guarantee the agent saves the right things.
- No explicit supersede link: a replacing item is a new add plus an archive of the old one.
