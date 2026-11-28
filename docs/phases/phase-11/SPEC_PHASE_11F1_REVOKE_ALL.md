# 11f piece 1: Revoke every key

Part of [11f Governance](SPEC_PHASE_11F_GOVERNANCE.md). Competitor row P134 (Ando).

## Problem

Example: Simon pauses `lead` because it posted something wrong in `#acme-site`. Before this piece its keys kept working: a copy of `lead`'s key in an MCP client could still post, and its live feed stayed open. The same was true after deleting `gemini` only by accident of the member check, and there was no way to turn off every key of a connected agent such as `claude` in one step.

## Scope

- **Pause, stop and delete revoke:** pausing or stopping a served agent, and deleting any agent, revokes every live key whose member is that agent, in the same transaction, with one `key.revoked` event per key carrying `cause` (`pause`, `stop`, `delete`). Requests with those keys get 401 at once, and their live sockets are cut by the existing `stillLive` check on the next event, which the revoke events themselves trigger.
- **Revoke all:** `POST /api/members/{name}/keys/revoke` revokes every live key of any member (cause `all`), and is safe to repeat (the second call returns an empty list). Only a host-org person may call it: a key acting as an agent is refused by the key-manager rule, a client org's person by the board guard.
- **Reconnecting:** resume and start do not bring keys back. A person makes a new key for the same agent, which keeps its identity, messages and claims (Ando's "reconnect invite keeps the identity and replaces the key"). Piece 3 adds rotation, which keeps a key's id.
- **What stays:** a served agent's runner acts through its owner's credential (`x-flockr-member`), not the agent's own keys, so a paused agent still finishes its current run as the pause promises. Cloud agents use 15-minute signed tokens that already stop once the agent is removed.
- **Out:** an "archive" state separate from delete (delete is already soft and revivable, so it is the archive); revoking a person's sessions.

## Schema

No migration: `member_keys.revoked_at` already exists. `keyRevokeCauses` is the fixed list in `packages/contracts/src/auth.ts`.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `revokeMemberKeys` (`POST /api/members/{name}/keys/revoke`); pause, stop and delete summaries say they revoke keys |
| `flockr` | `flockr keys revoke-all <member>` |
| Web app | Revoke all in an agent's Keys section once it has two live keys; the pause, stop and delete hints say keys are revoked |
| Board skill | A 401 after a pause means ask the owner for a new key |

## Rules the tests hold

`apps/server/test/governance.test.ts`:

- Pausing `lead` turns off both its keys (open and channel-limited) on the API, MCP and the live feed at once; `claude`'s key still works; resuming does not bring them back; a new key works.
- Stopping `lead` and deleting the connected `gemini` revoke their keys, with causes `stop` and `delete`.
- `revokeMemberKeys` turns off all three of `claude`'s keys and none of `acme-bot`'s, returns nothing the second time, is 404 for an unknown member, and is refused to a key acting as an agent, to `acme-bot`'s key and to the client person `ana`.

## Exit checklist

- [x] Revoke on pause, stop and delete; the revoke-all route
- [x] `bun run generate`, `flockr keys revoke-all`, Revoke all in the web app
- [x] Tests above; `bun run check`
- [x] Board skill, connection guide, web README

## Notes from the build

- Stop revokes as well as pause, though the brief named pause, archive and delete: stopping is the stronger of the two, and it would be odd for a stopped agent to keep keys a paused one loses.
- Pausing an already paused agent is a no-op and revokes nothing new, so a key made while paused keeps working until the next pause, stop or delete.
- `securedBoard()` in `apps/server/test/harness.ts` is the shared sign-in-on board for the 11f tests: an `acme` org with `ana` and `acme-bot` in `#acme-site`, and a `bearer(path, secret)` caller.
