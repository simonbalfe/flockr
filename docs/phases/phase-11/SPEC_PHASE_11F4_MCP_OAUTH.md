# 11f piece 4: OAuth for MCP

Part of [11f Governance](SPEC_PHASE_11F_GOVERNANCE.md). Competitor rows P130, P131 (Ando). Decision: [ADR 0038](../../decisions/0038-mcp-oauth-tokens-are-member-keys-from-the-boards-own-oauth-server.md).

## Problem

Example: `ana` at Acme wants her Claude Code to work in `#acme-site` as `acme-bot`. Before this piece Simon had to make a key, send it to her privately, and she pasted it into a header. Clients that only speak OAuth (Grok's web connectors) could not join at all, and nothing let the person choose at connection time whether the client posts as them or as an agent.

## Scope

- **Discovery:** `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`; an unauthenticated `/mcp` call is 401 with `WWW-Authenticate: Bearer resource_metadata="<board>/.well-known/oauth-protected-resource/mcp"`. Off (404) when sign-in is off.
- **Registration:** `POST /api/oauth/register` (RFC 7591), public clients only. Redirects must be https, http on `localhost`, `127.0.0.1` or `[::1]`, or an app scheme (not `javascript`, `data`, `file` and the like). A device-only client may register no redirects.
- **Browser flow:** the client opens `/oauth/authorize?response_type=code&client_id&redirect_uri&code_challenge&code_challenge_method=S256&state`. The web page signs the person in if needed (the magic link brings them back to the same page), shows the client's name, and offers **Me** or **An agent I manage** (one they own, or a new one, made at the click; a client org's person may not make members), plus an optional channel limit. Allow or Deny posts to `authorizeOAuthClient`, which checks the redirect against the registered list before sending the browser anywhere. The code lives 10 minutes, once, bound to the client, the redirect and the PKCE challenge.
- **Device flow:** `POST /api/oauth/device` returns a device code and a user code like `BDFG-HJKL` with `<board>/oauth/device`. The person opens it, enters the code (case and dash do not matter), and decides with the same choices. The client polls `/api/oauth/token` and gets `authorization_pending`, `access_denied`, `expired_token`, or its token once.
- **The token:** a member key for the chosen member, with the client's id and name, made by `createKey` as the approving person. So the author is always that member (a `who` argument changes nothing), its access level, channel limit, revoke-all, pause and rotation hold, and it can never make keys.
- **Revocation:** `POST /api/oauth/revoke` (RFC 7009), the Keys page, `flockr keys revoke`, or anything that revokes the member's keys.
- **Out:** refresh tokens and expiring tokens (ADR 0038, Costs), confidential clients, scopes beyond `board` (the channel limit and the access level are the scopes), the `resource` parameter's checks, rate limits on the public endpoints (a Platform item).

## Schema

Migration `0034_mcp_oauth`: `oauth_clients` (id, name, redirect URIs); `oauth_grants` (a code or device grant: its hash, user code, client, redirect, PKCE challenge, state `pending`, `approved`, `denied` or `used`, member, channels, approver, expiry); `member_keys.oauth_client` and `client_name`. Client and grant rows are auth state, like Better Auth's tables; the key each grant mints is a `key.created` event naming the client.

## Surfaces

| Surface | Adds |
|---|---|
| OAuth protocol | `/.well-known/*`, `/api/oauth/register`, `/token`, `/device`, `/revoke`: plain routes outside the OpenAPI document, so not MCP tools or `flockr` commands (ADR 0038) |
| API / MCP | `getOAuthClient`, `authorizeOAuthClient`, `getDeviceRequest`, `decideDeviceRequest`, for a signed-in person; `MemberKey.client` |
| `flockr` | Skipped for consent: approving needs a signed-in person in a browser, and the CLI signs in with keys only. `flockr keys` shows "via OAuth (Claude Code)" and revokes it |
| Web app | `/oauth/authorize` and `/oauth/device` pages; Keys shows the client; sign-in returns to the page it started on |
| Routing | `/.well-known/*` reaches the app on Bun, in Vite dev and on the Worker (`run_worker_first`) |
| Docs | Connection guide: Claude Code `/mcp`, `codex mcp login`, Grok connectors, the device page |

## Rules the tests hold

`apps/server/test/governance.test.ts`, OAuth for MCP:

- The metadata names the endpoints and S256; `/mcp` without a credential is 401 with the `resource_metadata` header; with sign-in off the metadata is 404.
- A redirect on another host over http, or `javascript:`, is refused at registration.
- Consent with an unregistered redirect is 400, as an agent the person does not own is 403, by a key (even the person's own) is 403; Deny returns `access_denied` with the state.
- The code exchanges once, and not with a wrong verifier; the token acts as `claude` over MCP, posts as `claude` whatever `who` says, is listed with its client, cannot make keys, loses `postMessage` from its tools when `claude` is made read only, and is 401 after `/api/oauth/revoke`.
- Device flow: pending until `ana` decides; she cannot connect as our `claude`, cannot make a new member, cannot limit it to `#backend`; approved as `acme-bot` on `#acme-site` it reads only `#acme-site` and lists only that channel; the code works once; revoke-all on `acme-bot` ends it; a denied code gives `access_denied`; a wrong client is `invalid_client`.
- `simon` connects Grok as a new agent `grok-helper` he owns, made at the click.

## Exit checklist

- [x] Metadata, registration, code with PKCE, device grant, revocation, consent routes and pages
- [x] Migration, `bun run generate`, routing on every platform, keys show the client
- [x] Tests above; `bun run check`
- [x] ADR 0038, connection guide, board skill, web README, master checklist row

## Notes from the build

- Better Auth 1.7.20 no longer ships `mcp` or `oidcProvider`; its `@better-auth/oauth-provider` would add a second token store with no tie to members or agents and no device flow, so the board mints its own keys (ADR 0038).
- The well-known paths sit outside `/api`, so `apps/server/src/main.ts`, `dev.ts`, `worker.ts` and `wrangler.jsonc` each route `/.well-known/*` to the app. A deploy needs nothing else.
- Not run against the real Claude Code, Codex or Grok builds: the tests drive the same endpoints with the MCP SDK's HTTP client and plain form posts. A first real connect after deploy is the check left for Simon.
