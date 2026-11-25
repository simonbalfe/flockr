# 0021: People sign in with Better Auth magic links from an allowlist; agents use keys

Status: accepted, 25 Nov 2026. Decided by Simon in chat. Settles "Decide before 1d: sign-in for people" and covers 3c (agent keys). Builds on [0017](0017-flockr-runs-on-cloudflare-through-platform-adapters.md) and [0010](0010-one-openapi-contract-generates-client-cli-and-mcp.md).

## Problem

The acting member is a plain `x-flockr-member` header, so anyone who reaches the board can act as anyone. That is why the server binds to `127.0.0.1` and nothing is deployed. A hosted board needs people to sign in and agents to prove who they are, without putting anyone's email address in the public repository.

## Options

| Option | Good | Cost |
|---|---|---|
| Email code, reusing flarebot's | Small, known code | Our own auth to maintain |
| An OIDC proxy in front (Cloudflare Access) | No auth code | Cloudflare-only; agents and the CLI need service tokens; breaks the self-host path |
| **Better Auth with its magic link plugin** | Maintained library; runs on Bun and Workers; sessions in our Postgres through Drizzle | A dependency and its tables |

| Email delivery | Good | Cost |
|---|---|---|
| **Cloudflare Email (`send_email` binding)** | Free, no new vendor | Sends only to verified addresses, which suits an allowlist |
| Resend | Any address | Another account and key |
| Log only | Nothing to set up | Nobody gets the email |

## Choice

- **People:** Better Auth with the magic link plugin, sessions in Postgres. Only addresses on an allowlist may sign in. The allowlist is configuration (`FLOCKR_PEOPLE`, `email=member` pairs, from Infisical), never code, so no address lands in the public repo. A signed-in person acts as the member the allowlist names.
- **Agents, the CLI, runners and MCP:** an API key per member, created by a person, stored hashed, sent as `Authorization: Bearer`. A key can be turned off on its own (3c).
- **Auth mode:** off by default for local development and tests, where `x-flockr-member` keeps working; on for any deploy. When on, the header is ignored and every `/api`, `/mcp` and `/ws` request needs a session or a key.
- **Email:** one email sender interface with one adapter per provider: a log adapter (prints the link, used locally) and a Cloudflare adapter on the `send_email` binding, living in `platform/cloudflare/`. The allowed address is verified once in Cloudflare Email Routing.

## Why

It closes the one gap that keeps Flockr off the internet, works the same on Bun and Cloudflare, and keeps personal details out of the repository.

## Costs

- Better Auth's tables and version upgrades.
- Cloudflare Email needs Email Routing on one of Simon's domains and a one-time verification of the address; adding a second person means verifying them too, or adding a Resend adapter.
- Every client (web, CLI, runner, MCP users) must carry a session or a key once auth is on.
