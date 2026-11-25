# 1d Sign-in and 3c agent keys

Design: [ADR 0021](../../decisions/0021-people-sign-in-with-better-auth-magic-links-agents-use-keys.md). People sign in with a one-time email link; agents, the CLI, runners and MCP clients send a key. Off by default, so local development and tests keep the `x-flockr-member` header.

## Scope

- **Auth mode.** `FLOCKR_AUTH=off|on` (default off), read in `apps/server/src/config.ts` and, on the Worker, from its env (`platform/cloudflare/env.ts`). Off: nothing changes; the header names the member. On: every `/api` request (except `/api/auth/*`, `/api/openapi.json`, `/api/docs`), `/mcp` and `/ws` needs a session cookie or `Authorization: Bearer <key>`, else 401 `unauthenticated`.
- **People.** Better Auth (pinned 1.7.20) with its magic link plugin and Drizzle adapter, mounted at `/api/auth/*`, built per app (so per request on the Worker, over Hyperdrive). `FLOCKR_PEOPLE` is `email=member` pairs, comma separated, from Infisical; never in the repo. Only those addresses may sign in: any other address gets the same "check your email" answer, no email and no stored token (a before hook), and Better Auth cannot create a user or session for it (database hooks). A signed-in person acts as the member the pair names; the person member is created on first sign-in. A link works once, for 15 minutes; tokens are stored hashed.
- **The header with sign-in on.** It is no identity. It can only narrow a person (session or key) to an agent that person owns, so one runner key serves every agent of its owner ("claude via simon"); any other value is ignored.
- **Keys (3c).** `member_keys`: id, member, SHA-256 hash, the first 7 characters (`shown`), optional channel list, created by, created at, last used (touched at most once a minute, not an event), revoked at. Only a person creates, lists or revokes; the key itself is in the create response once. `key.created` and `key.revoked` are events. Revoking twice changes nothing.
- **Channel limits.** A limited key may read members, channels and itself, claim the next task (only in its channels), and touch anything that resolves to one of its channels: `/api/channels/{c}/...`, a task, thread, message or activity entry in one, `listTasks` and `searchBoard` with `?channel=`, `createTask` in one. Everything else (events, inbox, agents, machines, routines, keys, unfiltered lists) and `/ws` is 403 (`apps/server/src/auth/scope.ts`). MCP is allowed; each tool call is checked.
- **Live socket.** Bun clients send the key as a header (`connectLive({ key })`); browsers send the session cookie, which a same-origin socket carries, so no ticket is needed. Checked before the upgrade in `main.ts`, `dev.ts` and `worker.ts`.
- **Email.** `EmailSender` (`apps/server/src/email/sender.ts`), adapters `log` (prints the link; default) and `cloudflare` (`platform/cloudflare/email.ts`: a MIME message through the `send_email` binding `EMAIL`). `FLOCKR_EMAIL` picks one, `FLOCKR_EMAIL_FROM` is the sender. Bun offers only `log`.
- **Settings.** `FLOCKR_AUTH_SECRET` (32+ characters, required when on), `FLOCKR_URL` (the board's public address; default `http://localhost:$PORT`, or the request origin on the Worker).

Out: roles beyond "a person manages keys", per-key scopes other than channels, a person removing their own sessions elsewhere, filtering the live feed by channel, a Resend adapter.

## Schema

Migration `0011_sign_in_and_keys`, additive: `member_keys`, and Better Auth's `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications` (all `timestamptz`).

## Surfaces

| Surface | What |
|---|---|
| API | `requestSignInLink` (`POST /api/auth/sign-in/magic-link`), `signOut`, Better Auth's `GET /api/auth/magic-link/verify`; `listKeys`, `createKey`, `revokeKey` (`POST /api/keys/{id}/revoke`); `whoami` adds `auth`, `via` and `channels`; `claimNextTask` stays in a key's channels |
| MCP | The same operations; credentials on `/mcp` are passed to each tool call |
| CLI | `flockr keys [list\|create <member> [--channels a,b]\|revoke <id>]`; `FLOCKR_KEY` (alias `FC_KEY`) is sent on every call and the live socket |
| Runner | `key` in `~/.flockr/runner.json`; sessions get `FLOCKR_KEY`, the approval bridge reads it from the config file |
| Web | Sign-in page (email, "Send me a link", "Check your email", a used-link message) when on and signed out; sign-out in the sidebar footer; Keys page and a Keys section in the agent panel (new key with optional channels, shown once with copy; revoke) |

Sign-in itself is web only: the CLI and agents use keys.

## Rules the tests hold (`apps/server/test/auth.test.ts`)

- An address not on the list gets the same answer, no email, no stored token, no user.
- A link signs in once, as the listed member, creating that person; reusing it fails; sign-out ends the session.
- With sign-in on, the header alone is 401 everywhere including `/mcp` and `/ws`; with a session it is ignored unless it names an agent the person owns.
- A key acts as its member on the API, MCP and `/ws`; a revoked key is 401; a channel-limited key works in its channel and is 403 elsewhere and on `/ws`.
- With sign-in off, the header still names the member.

## Exit checklist

- [x] Schema and migration via `bun run db:generate`
- [x] Better Auth on Bun (`main.ts`, `dev.ts`) and the Worker (`worker.ts`, bundles with `wrangler deploy --dry-run`)
- [x] Routes, `bun run generate`, MCP, `flockr keys`, runner `key`, web sign-in, sign-out and keys
- [x] Tests above; `bun run check`
- [x] Checked in the browser with sign-in on, the log adapter and an invented address

## Notes from the build

- The header could not simply be ignored: one runner serves several agents with one key. It now only narrows a person to an agent they own. The ADR's "the header is ignored" holds for every other value.
- Better Auth's sign-in endpoint stores the token before calling `sendMagicLink`, so the allowlist is a before hook that answers `{ status: true }` early; checking only in `sendMagicLink` would leave tokens for outsiders.
- `better-auth/minimal` avoids bundling Kysely into the Worker. Telemetry is off; cookies are prefixed `flockr`.
- The DOM `WebSocket` type has no headers option; `packages/client` checks for Bun at runtime and sends the key header there. Browsers rely on the cookie.
- The web app now learns its member from `whoami` (`actAs` in `apps/web/src/api/session.ts`) instead of the fixed `simon`.
