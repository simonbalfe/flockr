---
root: true
targets: ["*"]
description: "Flockr agent instructions"
globs: ["**/*"]
---

# Flockr

Flockr is Slack where AI agents are members too: people and coding agents share channels, and a task is a thread an agent can claim, work on and finish. It is headless: the API and its live events are the product, and the web app, the `flockr` CLI and the MCP server are clients of the same API.

**Start here.** Before changing anything, read in this order:

1. `docs/phases/SPEC_MASTER_CHECKLIST.md`, only the phase you are working in. This is where we are.
2. The newest file in `docs/handoffs/`, if it is about your work.
3. The spec for your sub-phase, `docs/phases/phase-N/SPEC_PHASE_<N><X>_<NAME>.md` (a Platform item's is `docs/phases/platform/SPEC_PLATFORM_PL<N>_<NAME>.md`), if it has one.

Then read the one router row that matches your task, and stop reading. Code wins when a doc disagrees; fix the doc in the same change.

## Router: what to read for what

| Your task | Read first (stop there if it answers you) |
|---|---|
| What is open, what to build next | `docs/phases/SPEC_MASTER_CHECKLIST.md`, only your phase |
| A Platform item (`PL1`, `PL2`, ...): hosting, deploys, adapters, backups, checks | `docs/phases/platform/README.md`, its row, then its spec there if it has one |
| Which competitor features a sub-phase must match | `docs/phases/SPEC_COMPETITOR_PARITY.md`, the rows naming that sub-phase |
| The whole design: parts, rules, where a change goes | `docs/guides/GUIDE_ARCHITECTURE_MODEL.md` |
| Why a design is the way it is | `docs/decisions/README.md`, then the one ADR |
| Add or change an API route | The nearest file in `apps/server/src/routes/` and its logic in `apps/server/src/board/`; schemas in `packages/contracts/src/`; then the backend checklist (`.rulesync/skills/review/backend.md`) |
| Claims, leases, needs, the event log | `apps/server/src/board/`, then the backend checklist, Claims and the event log |
| Change a screen | `apps/web/README.md`, then the `do-dashboard-ux` skill |
| Write or change TypeScript | The typescript checklist (`.rulesync/skills/review/typescript.md`) |
| Code rules and which lint rules come next | `docs/guides/GUIDE_CODE_STANDARDS.md` |
| Run, build or test locally | The Commands table below |
| Prove a change on the running app | The `do-verify` skill, only when Simon asks |
| Where a new doc goes | Where things go, below |

- Don't read `docs/decisions/` or `docs/reference/` for a routine change. Open them only when the task is about a past decision or the prototype.
- If a row sends you to a file that doesn't answer you, add the missing line to that file, not a new doc.

## Status

- **Building Phase 1 (headless core) and Phase 2 (web app).** The master checklist holds each sub-phase's status.
- **Sign-in is off by default** (ADR 0021): locally the acting member is the `x-flockr-member` header and the server listens on `127.0.0.1`. `FLOCKR_AUTH=on` needs a session (magic link, `FLOCKR_PEOPLE` allowlist) or a key on every `/api`, `/mcp` and `/ws` call; every deploy runs with it on.
- **Its own public git repository** (`github.com/simonbalfe/flockr`), in an ignored folder of the workspace. Nothing private goes in it.
- **Moving to Cloudflare through platform adapters** (ADRs 0017, 0018): the Platform track in `docs/phases/platform/README.md` holds the move. Local development and self-hosting stay on Bun and Docker Compose.
- **Speed first.** `bun run check` is the only gate. No pull requests and no review gate. Never add a check, hook, CI step or process on your own if it slows agents down; ship the fast version and tell Simon the heavier option exists.

## Tech stack

- **Runtime and repo:** TypeScript strict, Bun as runtime and package manager, a Bun workspace (`apps/*`, `packages/*`) (ADR 0005).
- **Server:** Hono with `@hono/zod-openapi`; Zod is the one schema language. One OpenAPI document generates the typed client, and the MCP server is built from it at startup (ADR 0010).
- **Data:** Postgres 17 through Drizzle: Docker locally, hosted through Hyperdrive on Cloudflare; claims use `FOR UPDATE SKIP LOCKED`; live events go through the `LiveSignals` interface in `apps/server/src/platform/`, Postgres `LISTEN/NOTIFY` on Bun (ADRs 0006, 0017). Files go to R2 through the S3 API.
- **Web app:** React 19 with Vite, TanStack Router and Query, shadcn/ui on Tailwind v4, zinc and monochrome, Geist font.
- **Surfaces:** the web app, `flockr` (CLI over the generated client), MCP at `/mcp`, the board skill in `skills/flockr/`.
- **Agnostic:** no harness, model, sandbox or outside service is named outside its adapter (ADRs 0007, 0009).

## Commands

| Command | What it does |
|---|---|
| `docker compose up -d db` | Start the local Postgres on `127.0.0.1:5432` |
| `bun install` | Install dependencies |
| `bun run db:migrate` / `bun run seed` | Apply migrations / load the example board |
| `bun run db:generate` | Write the migration for a schema edit; commit it and never edit an applied one |
| `bun dev` | Web app, API (`/api`), API docs (`/api/docs`) and MCP (`/mcp`) on one port, `http://localhost:5173`, plus a runner when a harness is installed (lines prefixed `runner │`; `FLOCKR_NO_RUNNER=1` turns it off) |
| `bun run generate` | Rewrite the OpenAPI document and the generated client after a route change |
| `bun run fc <command>` | The `flockr` CLI (being built) |
| `bun run test` / `bun run typecheck` | Server tests against Postgres and the runner's unit tests / typecheck every package |
| `bun run runner` | The runner alone: registers this machine and serves every agent assigned to it, starting a harness session for mentions, replies and tasks addressed to each; agents are made with New agent or `flockr agents create`, machine settings in `~/.flockr/runner.json` (`apps/runner/README.md`, ADR 0016) |
| `bun run build` / `bun run start` | Build the web app / serve it with the API |
| `bun run check` | **To add.** Typecheck, lint and tests; the only gate, run by the pre-push hook |
| `bun run lint` | **To add.** The lint rules in `docs/guides/GUIDE_CODE_STANDARDS.md` |
| `bunx rulesync@26.0.0 generate` | Regenerate `AGENTS.md`, `CLAUDE.md` and the skills after a `.rulesync/` change |

## Repository layout

```
apps/
  server/        # Bun + Hono: routes (src/routes), board rules (src/board), Postgres (src/db, drizzle/),
                 #   live events, the lease sweeper and the job drainer (src/live), MCP (src/mcp), config (src/config.ts)
  web/           # the Slack-style web app
  cli/           # `flockr`, over the generated client
  runner/        # one per machine: serves the agents assigned to it through harness adapters (src/harness), ADRs 0013, 0016
packages/
  contracts/     # browser-safe Zod schemas and fixed lists, shared by server, web and CLI
  client/        # generated from the OpenAPI document; never hand-edited
skills/flockr/   # the board skill any agent loads
docs/            # Markdown only, by kind: phases/, guides/, decisions/, handoffs/, reviews/; everything else in reference/
.rulesync/       # source of AGENTS.md, CLAUDE.md and the skills (generated files are gitignored)
.githooks/       # pre-push runs `bun run check`
```

## Always

A rule stays here only if breaking it is irreversible (data, secrets, what leaves the Mac) or it applies to nearly every change; the detail and examples live in the checklists (`.rulesync/skills/review/<kind>.md`).

- Everything the web app does is an API route first, and a new capability ships on every surface: the route with the regenerated client (`bun run generate`), the MCP tool (generated from the same document), an `flockr` command and a web app control, or the spec says why one is skipped (ADRs 0003, 0010).
- Never name a provider, harness, model or sandbox outside its adapter, and never branch on one's name: read a capability it declares (ADR 0009). Before: `if (member.source === "claude-code")`. After: `harnessFor(member.source).canResume`.
- Every write that can repeat is safe to repeat: a claim carries its fence number, a retried call changes nothing twice, and two agents claiming at once give exactly one winner.
- Every change is an event in the append-only log, written in the same transaction as the table it updates; an event is never updated or deleted, and an edit is a new event. The one exception is activity presence ("claude is working..."), which is current state sent live (ADR 0014).
- Decode with Zod once where data enters (HTTP, config, rows read as JSON, the live socket, outside services, agent and model output), then trust the type.
- A fixed set is one `as const` list in `packages/contracts` (`taskStates`), never an inline enum or a comparison to a raw string.
- Every timestamp is `timestamptz`. Never edit an applied migration; `bun run db:generate` writes a new one.
- Secrets are never printed or committed; they live in Infisical (`local` and `prod`). Tests, seeds and screenshots use invented people and tasks.
- Nothing acts unless asked: watchers and routines are off until someone turns them on, and anything that spends money or changes prod becomes a question a person answers.
- Dependencies are pinned exactly, and a new version is at least 14 days old.
- Docs move in the same change as the code: the spec, the area README, any guide, the board skill when agents see it.
- Test, check or review any web UI with the Chrome DevTools MCP (`chrome-devtools`), never Claude in Chrome and never Puppeteer. If it is not available to you, say so instead of substituting another driver.
- Full-stack local testing (`do-verify`) and reviews (`review`) run only when Simon asks.

**Where things go:**

| What you have | Where |
|---|---|
| Where we are: phases and sub-phases with a status | A row in `docs/phases/SPEC_MASTER_CHECKLIST.md`; a wait is that row's status, `Blocked: <what is needed>` |
| Testing, ops or infrastructure work: hosting, deploys, adapters, backups, checks | A Platform item: a row in `docs/phases/platform/README.md` (`PL<N>`), and `docs/phases/platform/SPEC_PLATFORM_PL<N>_<NAME>.md` when it needs a spec |
| One sub-phase's scope and exit checklist | `docs/phases/phase-N/SPEC_PHASE_<N><X>_<NAME>.md`, about a page, ending with `## Notes from the build` |
| A competitor feature | A row in `docs/phases/SPEC_COMPETITOR_PARITY.md` |
| A major decision: a tech choice, a boundary, a tradeoff, a reversal | An ADR, `docs/decisions/NNNN-<slug>.md`, plus its row in `docs/decisions/README.md`: problem, options, choice, why, costs |
| How the code works today, or how to do a task | `docs/guides/GUIDE_<AREA>_<TOPIC>.md` or the area README |
| A rule forever | An Always line if it passes the test above, else one line in a checklist; plus lint or a script when a machine can check it |
| What to fix this cycle | A review file in `docs/reviews/`, written by a `review` run |
| Work left mid-flight | `docs/handoffs/<YYYY-MM-DD>-<slug>.md` (the `flow-handoff` skill) |
| A repeated agent task | A skill in `.rulesync/skills/`, named `review`, `do-`, `flow-` or `tool-` by its job |
| A spike: a throwaway prototype or experiment (HTML, mock data, no backend) | `docs/spikes/` |
| Any other file that is not Markdown (HTML, images, diagrams) | `docs/reference/` |

- **ADRs:** record every major decision in the same change that acts on it, including one Simon makes in chat. Never rewrite an accepted ADR: add a new one that supersedes it and change only the old one's status line.
- Phases hold product features: work that can be Done and that people or agents see. Testing, ops and infrastructure work is a Platform item. A rule, an audit or debt is a checklist line.

## Workflow

One sub-phase at a time:

1. **MAP.** When a phase starts, write `docs/phases/phase-N/README.md`: its sub-phases, the focus of each and why that order.
2. **PLAN.** Spec the current sub-phase only, about a page: scope and what is out, schema, routes, the surfaces it adds, the rules its tests hold, an exit checklist. A change to something built updates the spec that owns it.
3. **BUILD.** Tests only for rules that must hold: claims, leases and fences, needs, event order, repeat-safety, and access once sign-in exists. A real decision gets an ADR. Decide small, reversible choices yourself and say which.
4. **CHECK AND SHIP.** Docs and Notes from the build in the same change; each lesson also goes where the next agent reads it (a checklist line, a skill, this file, an area README). `bun run check` once. Once Flockr has its own repository: one commit per change on `main`, ending with the trailer `Work: <slug>`, then push.
5. **UPDATE.** Tick the spec, set your own row in the master checklist to `Done (Work: <slug>)`, and report `<slug> done, docs: <files>, ADRs: <numbers or none>`.
6. **REPEAT.** Spec the next sub-phase from what this one taught.

- **The slug** is the sub-phase id and name (`1c-tasks`), or a short name for a fix (`fix-lease-expiry`): the same string for the Herdr tab, the session, the branch and the trailer.
- **Stop and ask Simon before:** exposing Flockr beyond `127.0.0.1`, deploying to a VPS, spending money (cloud sandboxes, paid model calls), deleting data that is not local test data, or a real scope change. Put every such question in one message at the start and keep working on what the answer doesn't affect.
- **Never wait.** A foreground command finishes in under 2 minutes. A long one (`bun dev`, a watcher) runs in a Herdr pane Simon can see; never `sleep` or poll in a loop.
- **Side tasks and reviews** run in a fresh session in its own Herdr tab in your project space, never in the context that wrote the code.
- **The pre-push hook:** once Flockr is a git repository, turn it on once with `git config core.hooksPath .githooks`. It runs `bun run check` when that script exists, and passes with a message until then.

## Skills (`.rulesync/skills/`)

Optional helpers, run on demand. No step requires one.

| Skill | What it does |
|---|---|
| `review` | Independent reviews (backend, typescript, security, frontend, docs, ux, design, observability), one fresh session per kind, each reproducing its findings and writing a review file in `docs/reviews/`. Only when Simon types `/review <kind> <scope>` or asks in his own words |
| `do-verify` | Full-stack local testing: Postgres in Docker, migrate, seed, `bun dev`, then the real API, MCP, `flockr` and web app, with evidence saved. Only when Simon asks |
| `do-dashboard-ux` | How to design, prototype and build a web app screen to the dashboard rules in the ux checklist (Apple HIG, Linear, Vercel; zinc, monochrome) |
| `do-architect` | Sketches two shapes of a change before code, picks the one with one owner per state, records both in the spec. Only when Simon asks. Adapted from pstack (MIT) |
| `do-blast-radius` | Finds what a change could break elsewhere and proves the one safety fact by running code. Adapted from pstack (MIT) |
| `flow-plan` | Writes the plan for several sub-phases: order, dependencies, files each may touch, verification; then stops. Adapted from pstack (MIT) |
| `flow-parallel` | Lets two or more agents work at once without clashing: separate files first, one writer only where truly needed. Adapted from pstack (MIT) |
| `flow-handoff` | Writes a handoff in `docs/handoffs/` at the end of a session with work in flight |

## Code conventions

**One definition per concept:** the backend checklist, One definition per concept, lists the home of each (routes, schemas, fixed lists, config, limits, wording, the generated client).

TypeScript: read the typescript checklist before writing or changing `.ts` or `.tsx` code.

| Rule | Why | Enforced by |
|---|---|---|
| No code comments | Names and types carry the meaning; a comment drifts from the code it describes | Review; lint planned |
| No `as` but `as const`, no `any` | A cast or an `any` hides a wrong shape the compiler would have caught | `strict` in `tsconfig.base.json`; lint planned |
| Every promise awaited or handed off with its error handled | A floating promise loses its error and races the next write | Review; lint planned |
| At most 3 parameters; one object when two share a type | An object argument cannot be passed in the wrong order | Review; lint planned |
| Variants are a union on `kind`; a `switch` ends in a `never` check | A new state fails to compile until every place handles it | `noFallthroughCasesInSwitch`; lint planned |
| Meaning by lookup: `satisfies Record<TaskState, ...>`, not `state === "blocked"` chains | A new task state fails to compile until its meaning is written | Review; lint planned |
| Env is read only in `apps/server/src/config.ts`, the CLI's config module and `apps/runner/src/config.ts` | One place to see every setting and its default | Review; lint planned |
| The web app and `flockr` reach the API only through `packages/client`; an outside service only through its adapter | One contract, so every surface agrees with the API (ADR 0010) | Review; lint planned |
| `packages/client` is never hand-edited | It is regenerated from the OpenAPI document and an edit is lost | `bun run generate` |
| Every route has an `operationId`, a summary and complete schemas | They become the MCP tool's name and text (ADR 0010) | Review; lint planned |
| `packages/contracts` imports nothing server-only (Drizzle, `postgres`, `node:`) | The browser bundle imports it | Review; lint planned |
| Scripts are TypeScript, never `.js`, `.mjs` or `.cjs` | One language, typechecked | Review |
| Dependencies pinned exactly; a new version at least 14 days old | A caret pulls in a release nobody chose; a fresh release is where supply chain attacks land | `bunfig.toml` `exact = true` and a dependency age check, both planned |
| No credential-shaped string in a tracked file | A committed secret has to be rotated | Secret scan planned in `bun run check` |
| Every relative link and backticked repo path in the docs and skills resolves | A dead pointer sends the next agent nowhere | Docs check planned in `bun run check` |
| A skill folder is `review` or starts with `do-`, `flow-` or `tool-`, and its `name:` equals its folder | The name says the skill's job | Review; docs check planned |
| Nothing reaches `main` red | The check is the only gate | `.githooks/pre-push` |
