# 0034. A run is fenced to its channel by a header that only narrows

Status: Accepted (28 Nov 2026, 11d)

## Problem

An agent woken in `#acme-site` runs with its owner's whole view of the board: its `flockr` commands can read `#backend`, search every channel and pull notes it saved elsewhere into an answer for a client. 11a's `canSee` keeps orgs apart, but not one agent's own channels apart within a run.

## Options

1. **A key per run:** the runner mints a channel-limited key when a run starts and revokes it when it ends. Works only with sign-in on, writes two events per run, and a crashed runner leaves live keys behind.
2. **A narrowing header:** every request may send `x-flockr-channels: acme-site`; the server intersects it with whatever the identity already allows (a key's channel limit, or everything). The runner sets `FC_CHANNELS` in each session's environment and `flockr`, the client and the live socket send it.
3. **Fence in the runner only:** filter what the runner puts in the prompt and trust the agent not to read further.

## Choice

Option 2. A header that can only take channels away is safe to trust from anyone, so it works the same with sign-in off and on, needs no state, and cannot outlive the run. It is the same `identity.channels` limit that 11a's keys use, so every guard (`requireInScope`, `canSee`, `visibleTo`) already honours it.

## Costs

- An agent that drops the header (unsets `FC_CHANNELS`, calls the API by hand) is no longer fenced. The fence keeps an honest agent from mixing channels; it is not a sandbox. A key per run (option 1) can be added for untrusted harnesses, and 11f's scoped keys cover clients.
- Reads that had no channel (list tasks, search, inbox, Focus, events, activity) now answer for the fenced channels instead of being refused under any channel limit.
- Agent notes gained a fence: under a limit only notes from threads in those channels, and notes from no thread, are listed or changed, and a note cannot be filed against a thread outside.
