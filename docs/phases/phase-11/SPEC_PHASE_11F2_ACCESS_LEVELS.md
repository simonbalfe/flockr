# 11f piece 2: Access levels

Part of [11f Governance](SPEC_PHASE_11F_GOVERNANCE.md). Competitor row P135 (Ando): per-agent access levels (read only, read and reply, full, custom) apply to keys and sign-ins alike.

## Problem

Example: Simon wants `acme-bot` to read `#acme-site` and answer questions there, but never claim a task or rewrite the channel document. Before this piece every credential an agent had could do everything its member kind may do; the only narrowing was by channel.

## Scope

- **Levels:** `read` (read only), `reply` (read and reply), `full` (the default), `custom` (reads plus picked grants). Grants are `reply`, `work` and `manage`; reading is never a grant. `grantsOf(level, custom)` in `packages/contracts/src/access.ts` is the one place a level turns into grants.
- **What each grant covers:** every operation in the OpenAPI document has one need. GET is `read`; a short list of writes that change only the caller's own state is `read` too (mark read, drafts, saved messages, sign-out, session chunks, the MCP transport). `reply` covers posting, replying, editing and deleting messages, reactions, DMs, asking and answering in threads, activity entries, files and scheduled posts. `work` covers tasks, plans, areas, checklists, notes, channel memory and the channel document. Anything not listed needs `manage`, so a new route is closed to limited agents until someone classifies it. The lists live in `apps/server/src/auth/access.ts`.
- **Where it holds:** in the request guard, after the channel scope and `canSee`, for the member the request acts as. So it covers every key of the agent, a person acting as it with `x-flockr-member` (a runner, a session), sign-in off (the header) and every MCP tool call, which goes through the same guard. MCP leaves the tools an agent may not use out of its tool list.
- **Who sets it:** `PUT /api/agents/{name}/access` by a host-org person, for any agent, served or connected, ours or a client org's. One `agent.access_changed` event per real change; repeating the same level writes nothing. People, bridges and watchers are always full.
- **Fixed on the way:** MCP tool calls now pass `x-flockr-channels` on, so the 11d channel fence holds over MCP as it does on the API.
- **Out:** a level per key (a key is narrowed by channels; the level is the agent's), a client org's owner setting its own agents' levels (piece 5 or later), and the runner skipping a read-only agent's wakes (its posts are refused, which is safe but noisy).

## Schema

Migration `0032_access_levels`: `members.access` (text, default `full`, checked against the four levels) and `members.access_grants` (text array, only for `custom`).

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `setAgentAccess` (`PUT /api/agents/{name}/access`); `Member` gains `access` and `grants`, so `/api/members`, `/api/me` and agents show them; MCP tool lists are filtered |
| `flockr` | `flockr agents access <name> read\|reply\|full\|custom [--grants reply,work,manage]`; `flockr agents show` prints it |
| Web app | Board access (a select, with grant toggles for custom) in an agent's panel for a person; a read-only Access row for others |
| Board skill | What a level is, how to read it with `whoami`, and that its 403 means stop, not retry |

## Rules the tests hold

`apps/server/test/governance.test.ts`:

- The need lists name only real operations; the matcher prefers fixed paths (`/api/tasks/claim`) to parameters; an unknown write needs `manage`.
- A read-only `claude` reads messages and marks read, and is refused posting, replying, creating and claiming tasks, by key, by the header with sign-in off and over MCP, whose tool list leaves out `postMessage` and `claimNextTask`; people are not limited.
- Read and reply posts but cannot create a task; custom `["work"]` creates tasks and cannot post; full gives everything back; only real changes are events.
- `simon`'s key acting as a read-only `claude` is refused; the same key as `simon` is not.
- A key acting as an agent and a client org's person cannot set access; mismatched inputs are 400; a person is 404; a client org's agent can be limited.
- An MCP client fenced to `#backend` is refused `#platform` on a tool call.

## Exit checklist

- [x] Levels, grants, the need of every operation, the guard and the MCP filter
- [x] Migration, route, `bun run generate`, `flockr agents access`, web control
- [x] Tests above; `bun run check`
- [x] Board skill, connection guide, master checklist row

## Notes from the build

- The need is keyed by `operationId`, matched from the OpenAPI document at the first request, so the request guard and the MCP tool filter read the same table and can never disagree.
- Fail closed: an unclassified write needs `manage`. A full agent never notices; a limited one is refused until the route is added to a list.
