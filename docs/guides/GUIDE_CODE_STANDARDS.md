# Code standards: which lint rules to port

Flockr's code rules live in `CLAUDE.md` (Code conventions) and the typescript and backend checklists in `.rulesync/skills/review/`. Today review enforces them. This guide lists which of maestro-service's lint rules and check scripts are worth porting so a machine enforces them instead, why each matters here, and the order to add them. Nothing here is built yet.

## Biome or ESLint

| Option | Good | Cost |
|---|---|---|
| ESLint with typescript-eslint typed linting, plus a small local plugin | Has every type-aware rule below (`no-floating-promises`, `no-unsafe-*`, `switch-exhaustiveness-check`); maestro-service's plugin is ESLint, so each custom rule is a copy and adapt | Slower; typed linting runs the TypeScript checker |
| Biome | Very fast; formats too | No `no-unsafe-*` family and only partial type-aware rules; custom rules are GritQL patterns, so the AST rules below need rewriting |

Recommendation: ESLint for lint, typed, with a local `eslint-plugin-flockr`; Biome only as the formatter if wanted. Check first that typescript-eslint supports the TypeScript 7 the repo uses; if not, typed lint runs against a TypeScript 5 dev dependency.

## Rules worth porting

Custom rules come from maestro-service's `tools/eslint-plugin-maestro/rules/`; the rest are standard typescript-eslint or ESLint rules.

| Order | Rule | What it refuses | Why it matters in Flockr |
|---|---|---|---|
| 1 | `bunfig.toml` `[install] exact = true` | A `^` or `~` written on `bun add` | Several `package.json` files already use carets and one uses `latest`; the Always rule says pinned exactly |
| 1 | Dependency age check (port `scripts/dependency-age.ts`, reading `bun.lock`) | A version new to the lockfile under 14 days old, unless named with its security fix | Supply chain attacks land in fresh releases; agents add packages often |
| 1 | Secret scan (port `scripts/secret-scan.ts`) | A credential-shaped string in a file that is not ignored | Agent keys, outside tokens and backup keys are coming; a committed one must be rotated |
| 2 | `@typescript-eslint/consistent-type-assertions` (`assertionStyle: never`), `no-unsafe-type-assertion` | `as`, except `as const` | A cast hides a wrong shape; the Code conventions rule |
| 2 | `@typescript-eslint/no-explicit-any` and the `no-unsafe-*` family | `any` and an untyped value flowing into typed code | Holds "decode with Zod once, then trust the type" at every `JSON.parse` and `response.json()` |
| 2 | `@typescript-eslint/no-floating-promises`, `no-misused-promises` | A promise not awaited or handed off | A lost claim or event write is silent; the sweeper and live listener depend on it |
| 2 | `max-params` at 3 | A fourth positional parameter | Many board functions already take `(db, actor, id, epoch)`; an object cannot be passed in the wrong order |
| 2 | `@typescript-eslint/switch-exhaustiveness-check`, `no-non-null-assertion`, `no-unnecessary-condition` | A switch missing a member, `!`, a check the types already rule out | A new task state fails to compile until every switch handles it |
| 3 | `no-comments` (custom) | Any code comment, except lint and type directives | Names and types carry the meaning; comments drift |
| 3 | `short-route-summary` (custom) | A route summary over 6 words or with `:;.` | The MCP tool text is the summary plus the description, so a short summary and a full description read well as a tool; today's summaries are whole sentences and would move into `description` |
| 4 | `no-process-env` (custom) | `process.env` or `Bun.env` outside the config modules | One place for every setting; already true in the server, so cheap to lock in |
| 4 | `no-raw-fetch` (custom) | `fetch(` outside the generated client and adapters | The web app and `flockr` must go through `packages/client` (ADR 0010); outside services through their adapter (ADR 0009) |
| 4 | `no-restricted-imports` | The database module imported outside the server's board and db code; server-only packages imported by `packages/contracts` or the web app | Keeps SQL out of routes and Drizzle out of the browser bundle |
| 5 | `no-inline-enum` (custom) | An inline `z.enum([...])` or string-literal union outside `packages/contracts` | One `as const` list per fixed set (`taskStates`) |
| 5 | `no-untyped-literal-comparison` (custom) | Comparing a contracts list value to a plain `string` | `state === "redy"` must fail to compile |
| 6 | `no-platform-name-branch` (custom, rename `no-provider-name-branch`) | A comparison or switch on a provider, harness or sandbox name outside its adapter folder | ADR 0009; add it with the first adapter list (sandboxes in Phase 4) |
| 6 | `no-literal-model-id` (custom) | A model id string outside the model adapter | Models swap often; add it with the first model call |
| 6 | `no-history-mutation` (custom, rename `no-event-mutation`) | An update or delete on the events table | The event log is append-only; an edit is a new event |
| 7 | `no-console` (with the server's log module and the CLI's output module allowed) | A stray `console.log` | Output goes through one place, so it can be redacted |
| 7 | Docs check (port `scripts/docs-check.ts`, the link and path part) | A relative link or backticked repo path in the docs and skills that does not resolve; a skill name that does not match its folder | Agents follow these pointers; a dead one sends them nowhere |
| 7 | knip | Unused files, exports and dependencies, and import cycles | Keeps the fake data layer from lingering once the real client lands |

Order 1 is cheap and protects against things that cannot be undone. Order 2 catches the most bugs per rule. Orders 3 to 5 lock in conventions the code mostly follows already. Order 6 waits for the code it guards. Order 7 is hygiene.

## Not worth porting now

| Rule | Why not |
|---|---|
| `no-cross-request-promise` | A Cloudflare Worker limit; Bun runs one long-lived process where a module-level promise is fine |
| `no-nondeterminism-in-workflow` | Guards Cloudflare Workflows replays; Flockr has none. Revisit if pg-boss jobs or Pi Durable tools need replay safety (ADR 0008) |
| `no-raw-telemetry` | Flockr has no telemetry module yet; add with one |

## How it plugs in

`bun run lint` runs ESLint; `bun run check` runs typecheck, lint, the scripts in order 1 and 7, and the tests, and the pre-push hook (`.githooks/pre-push`) runs `bun run check`. A rule that has an older violation starts with a baseline file of the existing ones, so new code is held at once and the backlog is fixed when next touched.
