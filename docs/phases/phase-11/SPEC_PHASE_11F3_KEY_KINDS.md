# 11f piece 3: Key kinds, provisioning and rotation

Part of [11f Governance](SPEC_PHASE_11F_GOVERNANCE.md). Competitor row P135 (Ando): delegated keys never manage keys; an admin-only provisioning key issues narrower keys for named agents; keys rotate and rescope with a stable id.

## Problem

Example: Simon gives a setup script `simon`'s own key so it can make keys for new agents. Before this piece that key could do everything Simon can, and any key acting as a person could mint more keys, so one leaked key could mint a quiet second one. Replacing a leaked secret meant a new key with a new id, and widening or narrowing a key's channels meant the same.

## Scope

- **Keys never mint keys:** a request made with a key (any member key, and the cloud agent tokens) is refused 403 on every key route: create, list, rotate, rescope, revoke and revoke-all. Only a signed-in person of the host org (or the header with sign-in off), or a provisioning key, manages keys.
- **Provisioning key:** `POST /api/keys` with `kind: "provisioning"` and `member` set to the person making it. Only that person makes it, never a key, and only in the host org (the board guard). It acts as its maker but may call only `whoami`, `listMembers`, `listChannels` and the key routes; anything else, MCP and the live feed are 403.
  - It makes `member` keys for agents only (ours or a client org's), never for a person, never another provisioning key.
  - Its channels are an issuing limit, not a read fence: a key it makes inherits them when none are given, and may name only some of them; it cannot rescope a key wider.
  - It lists, rotates, rescopes and revokes only keys it made (`madeByKey`); any other id is 404.
- **Rotation:** `POST /api/keys/{id}/rotate` replaces the secret and keeps the id, kind, member and channels. The old secret is 401 at once. A revoked key cannot be rotated (409); make a new key.
- **Rescoping:** `PATCH /api/keys/{id}` sets the channel limit (`null` opens it to every channel the member can see) and keeps the id and secret.
- **Live feeds:** every key carries a `version`, bumped by rotation and rescoping; a live socket remembers the version it opened with, so `stillLive` cuts it on the next event and the client reconnects under the new limit or secret.
- **Out:** a provisioning key limited to named agents (it may provision any agent; its channel limit is the narrowing), a client org's own provisioning key (piece 5 or later), expiring keys.

## Schema

Migration `0033_key_kinds` on `member_keys`: `kind` (`member` or `provisioning`, checked), `made_by_key` (the provisioning key that made it), `version` (0 on creation) and `rotated_at`.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `createKey` takes `kind`; `rotateKey` (`POST /api/keys/{id}/rotate`), `rescopeKey` (`PATCH /api/keys/{id}`); `MemberKey` gains `kind`, `madeByKey`, `rotatedAt`; events `key.rotated`, `key.rescoped` |
| `flockr` | `flockr keys create <you> --provisioning [--channels a,b]`, `flockr keys rotate <id>`, `flockr keys rescope <id> --channels a,b` or `--all`; the list shows the kind |
| Web app | Settings, Keys, New key: a Provisioning key checkbox; Rotate on every live key shows the new secret once; provisioning keys are marked in the list |
| Board skill | A key cannot make keys; ask a person |

## Rules the tests hold

`apps/server/test/governance.test.ts`:

- `simon`'s own member key is 403 on all six key routes, and still posts.
- Only `simon` makes a provisioning key for `simon`: for `tim` or `claude` it is 400, the client person `ana` and the agent `claude` get 403.
- A provisioning key makes channel-limited keys for `claude` and `acme-bot` that work, is refused a key for `tim` and another provisioning key, lists only its two keys, gets 404 on a key it did not make, is refused revoke-all, messages, agent controls, MCP and the live feed, and revokes its own key, which is then 401.
- Limited to `#backend` and `#platform`, it hands that limit down, may narrow to `#backend`, and is refused `#reviews` and opening a key to every channel.
- Rotation keeps the id and channels, makes the old secret 401 and the new one work, and ends the old live feed; rescoping keeps the secret, widens what it reads and ends that feed too; a repeat rescope is a no-op; a revoked key's rotation is 409; the events are created, rotated, rescoped, revoked in order.

## Exit checklist

- [x] Kinds, the no-mint rule, provisioning limits, rotation and rescoping with a stable id
- [x] Migration, routes, `bun run generate`, `flockr keys`, web controls
- [x] Tests above; `bun run check`
- [x] Board skill, connection guide, web README, master checklist row

## Notes from the build

- With sign-in on, `flockr keys` now needs a provisioning key: a person makes one in the web app (Settings, Keys) and uses it as `FLOCKR_KEY` for scripts.
- A provisioning key's channel limit must not reach the request guard: a channel-limited identity is never treated as host, so the guard would have refused it every key route. The middleware drops the limit for a provisioning key, which is safe because it may only call key routes.
- The cloud `BoardRoom` stores each socket's viewer; its saved key is now `{ id, version }`. Sockets saved before the deploy fail to decode and are dropped, and their clients reconnect.
