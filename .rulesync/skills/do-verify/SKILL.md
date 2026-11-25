---
name: do-verify
description: Full-stack local testing of Flockr: start Postgres in Docker, migrate, seed, run bun dev, then drive the real API, MCP server, flockr CLI and web app and save evidence. Slow. Use ONLY when Simon explicitly asks for full-stack or local end-to-end testing; never by default.
targets: ["*"]
---

# Verify Flockr

Prove a change on the real local app. Slow, so only when Simon asks; the default test is `bun run check` (until it exists, `bun run typecheck && bun run test`).

## Decision sheet first

When Simon asks you to test something "properly", do not start anything. Reply with this sheet, filled in for his change, recommend one option, and wait for his choice. If he already named an option, skip the sheet.

| Option | What runs | Cost (time, tokens, risk) | Proves | Misses |
|---|---|---|---|---|
| A Fast | `bun run check` only | Seconds; Postgres only for tests | Types, lint, the tests | Anything that needs the running app |
| B Hot path | The stack, then one call on the surface that changed (API, MCP, `flockr` or one screen) | A minute to start; a few calls | The changed route or screen works end to end | Other surfaces, concurrency, live updates |
| C Full coverage | B on every surface, plus two agents at once and the web app following live | Slowest: many calls and screenshots | Everything the change touches, locally | Other machines, a deployed board |

- Put real numbers in the cost column, and say whether the stack is already up.
- Name in one line what each option leaves unproven for this change.
- Recommend the lightest option that covers the risk. Pure docs, config or type changes get A.

## Start the stack

| Step | Command |
|---|---|
| Postgres | `docker compose up -d db`, then `docker compose ps db` shows it healthy |
| Install | `bun install` (only if dependencies changed) |
| Migrate | `bun run db:migrate` |
| Seed | `bun run seed` (the example board and its members) |
| Run | `bun dev` in a Herdr pane Simon can see (it does not exit): web app, API, API docs and MCP on `http://localhost:5173` |

- Check first: if `curl -sf http://localhost:5173/api/openapi.json` answers, the stack is up; use it.
- A clean board: stop `bun dev`, then `docker compose down -v` (deletes the local database only) and start again. Say so before doing it.
- Never point local testing at a deployed board.

## Drive each surface

| Surface | How |
|---|---|
| API | `curl -s http://localhost:5173/api/channels -H 'x-flockr-member: simon'`; every route is in `http://localhost:5173/api/docs` |
| Act as an agent | The same call with `-H 'x-flockr-member: claude'` |
| MCP | `curl -s http://localhost:5173/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`, then `tools/call` with the tool you changed |
| `flockr` | `bun run flockr <command> --json`; `flockr api <operationId>` reaches any route |
| Live events | `curl -s 'http://localhost:5173/api/events?since=0'` for the log; a WebSocket on `/ws` for the stream |
| Web app | The Chrome DevTools MCP (global `chrome-devtools`, headless and isolated) on `http://localhost:5173`, never Claude in Chrome; screenshots at 1440×900 and 390×844 |

## The checks only Flockr needs

- **Two agents at once:** claim the same ready task as `claude` and `codex` in parallel (two `curl` calls in one command with `&` and `wait`); exactly one wins and the other gets a clear refusal.
- **A stale holder:** claim, let the lease run out (or shorten it locally), claim again as the other agent, then complete as the first: refused for its old fence number.
- **Needs:** complete #806 and check #808 turns ready by itself, and the event log shows both.
- **Live:** with the web app open, act through the API or `flockr` and check the screen follows without a reload.
- **Every surface agrees:** the same action through API, MCP, `flockr` and the web app leaves the same state and the same events.

## Evidence

- Save to `.evidence/<slug>/` (gitignored): each command with its output, the event log before and after, and the screenshots, named by step.
- Use only the seed and invented names; no real message or key in evidence.
- Report: what ran, what passed, what failed with the command that shows it, and what stays unproven.
