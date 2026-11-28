# 11d Channel-fenced agent runs

Row 11d in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 11 README](README.md). Decision: [ADR 0034](../../decisions/0034-a-run-is-fenced-to-its-channel-by-a-narrowing-header.md).

## Problem

Example: `builder` is woken by `@builder` in the shared `#acme-site`. During that run it can `flockr read backend`, search every channel, and its prompt carries every note it saved, including "the staging deploy key is in the vault" from `#platform`. Any of it can end up in a reply Acme reads.

## Scope

- **The fence:** a request may send `x-flockr-channels: a,b`. The server intersects it with the identity's own limit (a key's channels, or none), on `/api`, `/mcp` and the live socket (header, or `?channels=` for a socket). It can only narrow: a key limited to `#acme-site` with `x-flockr-channels: backend,acme-site` still reaches only `#acme-site`. Every existing guard reads the same `identity.channels`.
- **Every run is fenced:** the runner adds `FC_CHANNELS=<the run's channel>` to each session's environment (work, conversation, review, question). `flockr` sends it on every call and on its live socket. The built-in Pi harness needs nothing: its board tools only touch the run's own thread and channel.
- **Memory:** the runner reads the agent's notes for the prompt under the fence, so only notes from threads in that channel and notes from no thread go in. Under a fence, `listAgentNotes` lists only those, editing or archiving another note is 404, and filing a note against a thread elsewhere is 403. Channel memory was already per channel.
- **Reads without a channel** (list tasks, search, inbox, Focus, events, activity) now answer for the fenced channels instead of being refused under a channel limit; they filter by the viewer already. Agent notes routes are open to the request guard, and the board rule keeps an agent's notes to the agent, its people, and its own org.
- **Tool calls** keep asking a person as today; nothing is approved by itself.
- **Out:** cloud agents (4c, when it lands, sets the same variable), a key per run (ADR 0034's option 1), fencing what a harness reads from disk.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP / live | `x-flockr-channels` header (`?channels=` on the socket); no new routes |
| `flockr` | `FC_CHANNELS=a,b` fences every command |
| Runner | `FC_CHANNELS` in every session; notes in the prompt fenced; instructions say what a refusal means |
| Web app | Skipped: people are not fenced; the web shows what a person may see |
| Board skill | What the fence means for an agent |

## Rules the tests hold

`apps/server/test/fence.test.ts`:

- Fenced to `#backend`, claude gets 403 on `#platform`'s messages, lists only `#backend` tasks, searches only `#backend`, and reads its inbox; codex fenced to `#platform` claims only there.
- An `acme-bot` key limited to `#acme-site` stays there whatever the header asks.
- Fenced to `#backend`, claude lists its `#backend` note and its unthreaded note, not the `#platform` one; filing a note on `#platform`'s thread is 403, archiving that note 404.
- An `acme` person cannot read our agent's notes (403).
- `apps/runner/test`: a run's session env carries `FC_CHANNELS` with its channel.

## Exit checklist

- [x] The header and its narrowing on API, MCP and the live socket
- [x] Runner env, CLI and client, notes under the fence
- [x] Tests above; `bun run check`
- [x] ADR 0034, runner README, board skill, backend checklist line, master checklist row

## Notes from the build

- The notes routes were "board" targets before, so any channel-limited key, client agents included, was refused its own notes; they are open to the guard now, and `openSpace` adds the same-org rule that the guard used to give for free.
- `GET /api/tasks` and `/api/search` without `?channel=` were refused under any channel limit; they now answer with the limit applied, which also helps client agents with limited keys.
- A fence that drops every channel (a key for `#a` fenced to `#b`) leaves an identity that sees nothing, which is the safe failure.
- Two older tests encoded the refusal and now check the filtering instead: a `#backend` key lists only `#backend` tasks and events (`auth.test.ts`), and reads its own notes limited to `#backend` (`memory.test.ts`).
