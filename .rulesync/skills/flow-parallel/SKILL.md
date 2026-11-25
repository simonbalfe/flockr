---
name: flow-parallel
description: Decide how two or more agents can work at the same time without clashing, by giving each its own files first and running work one after the other only where one writer is truly needed. Use before launching a second agent, when two sub-phases touch the same files, or when Simon asks "can this be parallelised".
targets: ["*"]
---

# Parallel work

Adapted from pstack's `principle-separate-before-serializing-shared-state` (MIT, Lauren Tan; see `LICENSE`).

When two agents might write the same file, row or database, first ask whether they need one shared thing or are each publishing their own facts. Default to separating: each agent gets its own file, folder, test database or branch, and the pieces meet only where they are read. Run work one after the other only when a single shared writer is a real rule.

Instructions are not concurrency control. "Don't touch the other agent's section" still lets two agents clash; a separate file does not.

## Steps

1. List every shared write target the agents would touch: source files, generated files, migrations, docs, the local database, and the branch they ship to.
2. For each, try to separate it first:
   - New code goes in a new file, and the shared file gains only an import and one line (a new routes file, then one `.route(...)` in `apps/server/src/app.ts`).
   - Each agent writes its own spec, and edits only its own row in a shared index.
   - Each agent names its test data with its slug (a channel `1c-tasks-test`) and removes only its own.
   - While Flockr has no git repository, agents share one folder: give each a folder it alone writes, and say in each brief which folders are someone else's.
3. Serialize only what stays truly shared, and do it with structure, not a promise. These are the hot files: flag an agent touching one even when no other agent has yet.

| Shared target | Serialize by |
|---|---|
| The branch everyone ships to (`main`, once Flockr is a git repository) | Rebase on the latest before every push, then check the diff lists only your files |
| `packages/client` (generated) and `packages/client/openapi.json` | Never merge by hand; rerun `bun run generate` after the other change lands |
| Drizzle migrations in `apps/server/drizzle/` (numbered, with a journal) | One agent writes migrations at a time; after the other lands, delete your own unshipped migration and rerun `bun run db:generate` |
| `apps/server/src/db/schema.ts` | One agent per table at a time |
| `apps/server/src/app.ts` (route mounts) and `packages/contracts/src/index.ts` (exports) | Add one line each; on a clash keep both lines |
| Root `package.json` and `bun.lock` | One agent changes dependencies at a time; rerun `bun install` after the other lands |
| `SPEC_MASTER_CHECKLIST.md`, phase READMEs | Each agent edits only its own row; on a clash keep both rows |
| `.rulesync/` (the source of `CLAUDE.md`) | One agent at a time; rerun `bunx rulesync@26.0.0 generate` after the other lands |
| The local Postgres | Tests use `TEST_DATABASE_URL`; two agents running tests at once each get their own test database |
| Two sub-phases that change the same shape | Run them one after the other |

4. Write the result into the launch brief of each agent: the files it owns, the shared files it may only add a line to, and what it must regenerate after the other lands.

## Example: tasks (1c) and the `flockr` CLI (1e)

| Shared | Finding | Decision |
|---|---|---|
| `packages/contracts/src/board.ts` holds the task shapes | 1e only reads them | 1e imports; only 1c edits |
| `packages/client` | Both need the new routes in the client | 1c regenerates when its routes land; 1e starts on routes that already exist and regenerates after 1c |
| Root `package.json` and `bun.lock` | 1e may add a dependency for argument parsing | 1e alone changes dependencies during the pair |
| Claim and lease behaviour | 1e's `flockr tasks claim --wait` depends on 1c's claim answer | 1e builds `--wait` after 1c ships |
