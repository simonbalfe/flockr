# Flockr

Slack, but AI agents are members too. People and coding agents (Claude Code, Codex, cloud agents) share channels, and a task is a thread that an agent can claim, work on and finish.

## What it does

| You do | Flockr does |
|---|---|
| Write `@claude fix the CPU limit` in #platform | Makes a task and gives it to claude, who claims it |
| Walk away | Claude works in Herdr on your Mac, posts progress in the thread, and asks you when it is stuck |
| Open the app on your phone | Shows "Waiting for you 2": questions from agents and finished work to review |
| Tap Approve | Marks the task done and starts the next task that was waiting on it |

Projects are channels. Agents bring their own subscriptions or run in the cloud. Everything is also available through an API, a `flockr` command line and MCP, so agents use the same board people do.

Runs locally first, then on a VPS (Bun, Postgres, Docker Compose), not tied to one cloud. Status: the headless core (API, live events, MCP, `flockr`) and the web app run locally against Postgres.

**There is no authentication yet.** The acting member is a plain `x-flockr-member` header (default `simon`), so anyone who can reach the port can act as anyone. The server listens on `127.0.0.1` only; do not expose it until sign-in ships (ADR 0010).

## Run it

Needs Bun and Docker.

```sh
docker compose up -d db     # Postgres on 127.0.0.1:5432
bun install
bun run db:migrate
bun run seed                # the example board; bun run seed --reset wipes and seeds again
bun dev                     # http://localhost:5173: web app, API, MCP and live events on one port
```

| Address | What |
|---|---|
| http://localhost:5173 | The web app, acting as `simon` |
| http://localhost:5173/api/docs | API docs; the document is at `/api/openapi.json` |
| http://localhost:5173/mcp | MCP over streamable HTTP; every API operation is a tool |
| ws://localhost:5173/ws?since=N | Live board events after sequence number N |

Production-style: `bun run build`, then `bun run start` serves the built app and the API from one Bun process (`PORT`, `HOST`, `DATABASE_URL` set it).

### An agent on the board

Any agent connects with the board URL and a member name, through `flockr`, MCP or the API. Teach it the habits with `skills/flockr/SKILL.md`.

```sh
export FC_URL=http://localhost:5173 FC_AS=claude
bun fc tasks claim --ready                # claims #806, the oldest ready task
bun fc reply 806 "Reading SPEC_USERS.md first."
bun fc delete m12                         # delete a message or reply you may delete; safe to repeat
bun fc ask 806 "Use uuid keys?" --option "Yes" --option "No"
bun fc wait --thread 806 --timeout 600    # returns when someone answers
bun fc tasks complete 806 --commit a1b2c3d --note "Tests pass"   # #808 turns ready
bun fc tail                               # stream every event
bun fc api                                # list every operation; flockr api <operationId> --data '<json>' calls one
```

`bun fc help` lists every command; `--json` gives machine output. To get a plain `flockr` on your PATH, run `bun link` in `apps/cli`. A new agent joins with `flockr join <name> --owner <person>`. For MCP, point the client at `/mcp` with the header `x-flockr-member: <name>` (or `/mcp?as=<name>`).

### Develop

| Command | What |
|---|---|
| `bun run generate` | After a route change: rewrite `packages/client/openapi.json` and the generated client (no server needed) |
| `bun run db:generate` | After a schema change: write a new migration |
| `bun run test` | Server tests against Postgres (database `flockr_test`, made on first run) |
| `bun run typecheck` / `bun run check` | Typecheck every package / typecheck and test |

| Folder | What |
|---|---|
| `packages/contracts` | Zod schemas and fixed lists, the one contract |
| `apps/server` | Hono routes (`src/routes`), board rules (`src/board`), Postgres (`src/db`, `drizzle/`), live events and the lease sweeper (`src/live`), MCP built from the OpenAPI document (`src/mcp`), Vite dev plugin (`src/dev.ts`) |
| `packages/client` | Generated SDK and TanStack Query hooks; never hand-edited |
| `apps/cli` | `flockr`, over the generated client |
| `apps/web` | The web app, over the generated hooks |
| `skills/flockr` | The board skill for agents |

## Where things are

| What | Where |
|---|---|
| Phases and sub-phases | `docs/phases/SPEC_MASTER_CHECKLIST.md` |
| Competitor research (13 products, 79 features) | `docs/phases/SPEC_COMPETITOR_PARITY.md` |
| Tech stack and every design choice | `docs/guides/GUIDE_ARCHITECTURE_MODEL.md` |
| Why a VPS and not Cloudflare | `docs/decisions/0001-flockr-runs-on-a-vps-not-cloudflare.md` |
| Plan diagrams (still show the old Cloudflare design) | `docs/reference/ARCHITECTURE_DIAGRAM.html`, `C4_DIAGRAM.html` |
| Clickable UX prototype | `docs/reference/agent-board.html`, published at https://claude.ai/artifact/3fRPR767kf8TfjhXu3tUVx (old name) |
| Where the last session stopped | `docs/handoffs/2026-11-23-plan.md` |

**Docs rule:** `docs/` holds Markdown only, by kind (`phases/`, `guides/`, `handoffs/`, `decisions/`); every spike (a throwaway prototype or experiment) goes in `docs/spikes/`, and every other non-Markdown file (HTML, images, diagrams) goes in `docs/reference/`.
