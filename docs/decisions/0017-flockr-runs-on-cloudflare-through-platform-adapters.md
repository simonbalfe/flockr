# 0017: Flockr runs on Cloudflare through platform adapters; Postgres and R2 stay portable

Status: accepted, 25 Nov 2026. Decided by Simon in chat. Supersedes [0001](0001-flockr-runs-on-a-vps-not-cloudflare.md). Supersedes in part [0006](0006-postgres-is-the-data-store.md) (live events no longer depend on `LISTEN/NOTIFY` everywhere) and [0007](0007-sandbox-runtime-is-agnostic.md) (Docker on the VPS is no longer the first adapter). Research: `docs/reference/RESEARCH_CLOUD_AGENTS.html`; diagram: `docs/reference/C4_CLOUDFLARE_NATIVE.html`.

## Problem

0001 put Flockr on a VPS because coding agents need a real machine and Cloudflare had none. Since then Cloudflare added a durable agent workspace (Cloudflare Computer, August 2026) and rebuilt Containers for agent sandboxes (30 September 2026), so agents can run there. A VPS never scales to zero and has to be patched and backed up. Simon wants scale to zero without being locked to one vendor.

## Options

| Option | Good | Cost |
|---|---|---|
| Keep the VPS (0001) | Built; no rewrite; one machine | Always on; we run backups, patching, uptime |
| Cloudflare all in: Durable Object storage and D1 for the board | Least code | Board and agent data only exist on Cloudflare |
| No VPS, no Cloudflare: hosted Postgres, a container host that sleeps (Fly), a hosted sandbox (Blaxel or E2B) | Agnostic | Three vendors; live events and agent hosting still need a long-lived process |
| Rivet 3.0 actors on servers we run | Open source; the Durable Object model with S3 storage built in | Something always runs; 3 engine instances for production; no serverless in 3.0 |
| **Cloudflare through platform adapters, with Postgres and R2 as the portable data layer** | Scales to zero; no servers; data and core code leave with us | Two entry points; adapters to write; hosted Postgres is a second vendor |

## Choice

- **Core stays plain TypeScript.** The Hono app (`createApp`), board rules and schemas do not import `cloudflare:workers`, Durable Objects, bindings or Bun APIs. Only `apps/server/src/platform/` and the entry files do.
- **Two entry points.** A Worker entry for Cloudflare, and the Bun entry (`main.ts`, `dev.ts`) for local development and self-hosting with Docker Compose.
- **Portable data.** The board stays in Postgres through Drizzle: hosted Postgres (Neon or Supabase) reached through Hyperdrive in production, Docker locally. Files and backups go to R2 through the S3 API, never R2 bindings, so any S3 store works.
- **Platform pieces behind interfaces**, one implementation per platform:

| Interface | Cloudflare | Bun (local, self-host) |
|---|---|---|
| Live signals (`LiveSignals`, `LiveListener`) | A Durable Object per board pushing to WebSockets | Postgres `LISTEN/NOTIFY` |
| Agent host (wake, steer, schedule) | A Durable Object per agent ([0018](0018-durable-objects-are-disposable.md)) | The runner process |
| Sandbox (0007) | Cloudflare Computer and Containers | Docker |
| Schedules | Cron Triggers and Durable Object alarms | Timers in the server |

- **Durable Objects are disposable** ([0018](0018-durable-objects-are-disposable.md)).
- The move is the Platform track (`docs/phases/platform/README.md`); product phases are unchanged.

## Why

It keeps scale to zero and removes the box we would run, while the parts that would trap us (board data, files, board rules) stay standard. Leaving Cloudflare means writing adapters, and the Bun ones exist already.

## Costs

- Live events, the runner and timers must move behind interfaces before Cloudflare code lands (PL1).
- Two entry points and two implementations per interface to keep working; both are tested.
- Hosted Postgres is a second vendor; `LISTEN/NOTIFY` is not used on Cloudflare, and a pooled connection cannot listen.
- Workers limit CPU time per request, so long work (agent runs, sweepers) lives in Durable Objects or alarms.
- Cloudflare Container start times after the September rebuild were not measured.
- 1a's VPS deploy with Caddy and SSH is replaced by the Platform deploy items.
- Watchers (5a) planned pg-boss, which needs a long-lived worker; on Cloudflare it runs from a Durable Object alarm or is replaced, decided in 5a.
