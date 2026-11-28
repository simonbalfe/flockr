# 0036: A cloud agent is a runner of one inside its Durable Object, poked by the board and calling it in-process

Status: accepted, 28 Nov 2026. Work: 4c-cloud-agents. Decided by the agent building 4c within Simon's brief (Pi Durable on the object's SQLite, PL5 chunks, the model proxy). Builds on [0008](0008-pi-durable-is-the-built-in-agent-harness.md), [0016](0016-agents-are-created-in-the-app-and-served-by-machine-runners.md), [0018](0018-durable-objects-are-disposable.md), [0024](0024-the-board-is-the-model-key-proxy.md), [0032](0032-worker-sessions-are-saved-as-chunks-in-the-bucket-at-turn-end.md), [0034](0034-a-run-is-fenced-to-its-channel-by-a-narrowing-header.md).

## Problem

An agent must answer with every laptop shut. ADR 0018 put one Durable Object per cloud agent hosting Pi Durable, but left open how the object learns it has work, how it reaches the board and the model, and how much of the runner it repeats. Every wake rule (mentions, replies in joined threads, tasks, reviews, verdicts, other orgs, the agent chain limit, the run fence) already lives in the runner, and was fixed twice this week (`5671d72`, `e6d59bd`).

## Options

| Option | Good | Cost |
|---|---|---|
| The object holds a live socket to the board, like a runner | Same feed as a Mac | An outgoing socket keeps the object awake and billed; no hibernation |
| The board decides who to wake and calls `handleWake(agent, message)` | Exact wakes | A second copy of every wake rule, in the board, to keep in step |
| **The board pokes every serving cloud agent after each write; the object reads its events as itself and runs the runner's own service and rules** | One copy of the rules; objects sleep between pokes; `canSee` filters what each reads | One object request per cloud agent per write |

How the object reaches the board: over the public URL with a key (a stored secret per agent, and a Worker fetching its own hostname), or **in-process through the same Hono app with a short signed agent token** (no network hop, nothing stored).

## Choice

- The machine `cloud` is a hosted machine row (`machines.hosted`): it runs on the board's own platform, its agents need no folder and use board tools only. Hosting is a declared capability, never a name check.
- `CloudAgent`, one object per agent, runs `createService` and `createRunner` from `apps/runner` for that one agent, with the Pi adapter on the object's SQLite through `openDurableObjectSqliteStorage`'s database and `onWake` arming the alarm. Its machine port reports only its own agent.
- After every `/api` write that published live signals, the Worker pokes each serving cloud agent (`waitUntil`); the minute cron pokes them too and writes the cloud machine's heartbeat. A poked object reads `listEvents?since=<cursor>` and feeds the runner.
- Board calls are in-process requests to the app, signed in with `fag_<claims>.<signature>`: the agent's name and a 15-minute expiry, HMAC-SHA256 from the sign-in secret, re-minted per call. The model is reached the same way at `/api/model` with a box token (0024).
- Sessions save one `pi-rows/1` chunk per turn through `saveSessionChunk` (0032); an object without Pi tables restores from them first.

## Why

The rules stay in one place and were already tested against the real board; the object only supplies storage, a clock and a feed. In-process calls keep every access rule in force without a stored credential or a second network hop.

## Costs

- A write wakes every serving cloud agent's object for one events read. Fine for a few agents; past that, narrow the poke with a cheap prefilter (mentions, assignee, reviewer, joined threads).
- The agent token is as strong as the sign-in secret; rotating it revokes all tokens at once, which is harmless because they live 15 minutes.
- A turn in progress lives only in the object until it ends (0032).
- The Worker bundle now carries the runner core and Pi Durable; the runner core must stay free of Bun and file config, held by `wrangler deploy --dry-run` and the worker typecheck.
