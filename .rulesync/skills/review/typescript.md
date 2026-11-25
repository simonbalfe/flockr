# TypeScript review checklist

Scope: every `.ts` and `.tsx` file in the change. Read it before writing or changing TypeScript; a `backend` review checks it too. Adapted from pstack's `typescript-best-practices`, `principle-type-system-discipline` and `principle-boundary-discipline` skills (MIT, Lauren Tan; see `typescript.LICENSE`). Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins.

A line marked **(lint planned: ...)** names the rule that will catch it once `bun run lint` exists (`docs/guides/GUIDE_CODE_STANDARDS.md`); until then, and for every other line, it is the review's job.

- **Two principles:**
  - types carry the rules: the compiler rejects impossible states, mixed-up ids and unhandled variants, so a reader never trusts a comment or a runtime check
  - check at the edge, trust inside: data is decoded once where it enters into a named type; inside, no re-validation and no defensive null checks. Ask of any check: is this data crossing a boundary right now? If not, the check is redundant
- **Discriminated unions:** variants are a union on a `kind` literal, never a bag of optional fields and booleans. `kind` is the one discriminant name; no `type` or `tag`.
  - before: `{ loading: boolean; task?: Task; error?: string }`
  - after: `{ kind: "loading" } | { kind: "ready"; task: Task } | { kind: "failed"; message: string }`
- **Expected failures are values:** a failure a caller branches on (a stale fence, a task not ready, a lease already held) is a typed value or a typed error with its `kind` and HTTP status (today `BoardError` in `apps/server/src/board/errors.ts`); throw a plain error only for a bug. How a route maps each kind to a status is in [backend.md](backend.md), Failures.
- **Zod owns the shape:**
  - the schema is the one definition and the type is `z.infer` (or `z.output`) of it; never a schema plus a hand-written interface plus a guard that can drift
  - no hand-rolled property-by-property guard for outside data
  - when the type must come first, annotate the schema with it: `const taskSchema: z.ZodType<Task> = z.object({ ... })`
  - Zod is the one schema language, imported from `@hono/zod-openapi` in contracts and routes, so every schema can carry its OpenAPI metadata
  - objects strip unknown keys by default, which keeps wire formats forward compatible; `z.strictObject` only where an extra key is a real error
- **Decode once at the boundary:**
  - HTTP input (the route's schema), config (`apps/server/src/config.ts`), rows read as JSON, live socket messages, `JSON.parse` of anything stored, outside service responses and agent or model output are decoded once where they enter; no `as` standing in for a decode
  - `safeParse` where failure is an expected branch (a socket message, an outside service) and turn it into a typed failure; `parse` only where a bad value is a bug
  - after the decode the value is trusted: board logic never checks `typeof task.id === "number"` again **(lint planned: `no-unsafe-*`; an `any` from `JSON.parse` or `response.json()` cannot reach a typed value undecoded)**
  - board rules are plain functions in `apps/server/src/board/`; routes, the MCP server and the sweeper stay thin around them
- **`unknown` over `any`:** outside data is `unknown` until Zod decodes it **(lint planned: `no-explicit-any`, `no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`)**
- **No raw domain strings:** a fixed set is one `as const` list in `packages/contracts` (`taskStates`, `memberKinds`, `agentStates` in `packages/contracts/src/board.ts`); its type and schema come from it (`z.enum(taskStates)`, `(typeof taskStates)[number]`), and a subset is `Extract` or `Exclude`, never a new list. A set one module owns stays in it as a named list or an unexported type (`type Panel = "thread" | "task" | "agent"`) **(lint planned: `no-inline-enum`)**
- **Meaning by lookup, not by comparison:** what a list value means in a feature is a table keyed by that list, checked with `satisfies Record<TaskState, ...>`, so a new state fails to compile until its meaning is written.
  - before: `state === "blocked" ? "text-destructive" : state === "waiting" ? "text-faint" : "text-foreground"`
  - after: `stateTone[state]`, with `const stateTone = { waiting: "text-faint", ready: "text-foreground", ... } as const satisfies Record<TaskState, string>`
- **Branded ids:** once two ids of the same base type can be swapped (a task id and a message id are both numbers), each is branded by its schema in `packages/contracts` (`taskIdSchema = z.number().int().brand<"TaskId">()`), so the brand comes from a decode, never from `as`. The brand runs from the column (`.$type<TaskId>()`) through board functions and route signatures, never a plain `number`.
- **Constructive modeling:** build the shape so the bad value cannot be written: `[T, ...T[]]` for non-empty (`z.array(z.string()).nonempty()`), `{ start; durationMs }` for a lease, never `{ start; end }` with a comment. A question card's options are at least two (`.min(2)` in `Question`).
- **Simplest total type:** keep `T[]` while every use stays total; strengthen only where the loose type forces `!`, a cast or a "can't happen" throw: `tasks.at(0)!` becomes `oldest(tasks: NonEmpty<Task>)`. `noUncheckedIndexedAccess` is on, so an index read is `T | undefined` **(lint planned: `no-non-null-assertion`, `no-unnecessary-condition`)**
- **No `as` casts:** never `as`; `as const` is fine **(lint planned: `consistent-type-assertions` with `assertionStyle: never`, `no-unsafe-type-assertion`)**. To remove one, find why the compiler could not infer:
  - missing discriminant: add a `kind`
  - source too wide (`Record<string, unknown>`): decode with the schema that owns the shape
  - an empty collection: `new Array<Task>()`, `new Map<number, Task>()`, or annotate the variable
  - a literal membership check: a small `isOneOf(list, value)` helper in `packages/contracts`, written once
  - a library type that is wrong: `z.custom<T>(check)`
  - genuinely inexpressible: a brand or `satisfies`
- **`satisfies` over `as` or an annotation:** a literal is checked with `satisfies`, never widened: label maps (`taskStateLabels ... as const satisfies Record<TaskState, string>`) and failure status maps.
- **Narrowing order:** a `kind` switch or `if`, then `"key" in value`, then `typeof` or `instanceof`, then a type guard, then `as` last.
- **Honest type guards:** a guard named `isX` or `hasX` checks what it claims; a lying guard is worse than `as`. Prefer a `kind` switch.
- **Exhaustiveness:** a `default` arm holds `const unhandled: never = value;`, so a new member fails to compile until every switch handles it; a lookup with no logic is a `satisfies Record<Union, X>` map **(lint planned: `switch-exhaustiveness-check`)**
- **Derived types:**
  - reach for `z.infer`, the generated client's types, `Pick`, `Omit`, indexed access, `Parameters`, `ReturnType`, `Awaited` and `typeof` before declaring a type; a type that follows another is derived, never retyped (`Pick<Task, "id" | "title" | "state">`)
  - the web app and `flockr` take response types from `packages/client` and shared shapes from `packages/contracts`, never a copied type; a hand-written `types.ts` beside the client is a finding once the client covers it **(lint planned: knip fails on an export nothing imports)**
- **Promises:** every promise is awaited, or handed off with its error handled and reported (a `.catch` that logs and reports, never an empty one); in a React handler, a mutation goes through TanStack Query's `mutate`, or `void` with its failure shown **(lint planned: `no-floating-promises`, `no-misused-promises`)**
- **Object args:** one object when a function takes two or more values of the same type, so they cannot be swapped (`claimTask({ taskId, member, epoch })`), and always for four or more; a callback whose signature a library fixes keeps it **(lint planned: `max-params` 3; two of the same type is judgment)**
- **Modules:** no import cycle between modules; a cycle is broken by moving the shared part down, never by a lazy import **(lint planned: knip or `import/no-cycle`)**
- **No comments, no stray console:** names and types carry the meaning **(lint planned: `no-comments`)**; logging goes through one place in the server and the CLI's output module, never a `console.log` left in a feature **(lint planned: `no-console`)**

## Learned from reviews

Each line is a class of mistake an earlier review caught, added by that review's run (step 5 of the skill), with the review file it came from. Check every line here as well as the checks above.
