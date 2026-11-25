# 3e Checklist import

A repo's `SPEC_MASTER_CHECKLIST.md` rows become tasks with their order, and completing a task ticks its row.

## Scope

- **Parse.** One parser, `parseChecklist` in `packages/contracts/src/checklist.ts`, shared by the server and `flockr`. It reads table rows under `## Phase N: ...` headings whose first cell is `<id> <name>` (`1a Skeleton`, `4c Cloud agents`). Delivers and Status are found by the table's header row (Delivers falls back to the third cell, Status to the last). A row is Done when its Status starts with `Done`. Each row carries the exact span of its Status cell so a rewrite touches only that text. Rows in other sections (the `## Phases` summary), fenced code and header or separator rows are ignored.
- **Import.** `POST /api/channels/{channel}/checklist` (`importChecklist`) with `{ markdown }`. Each row not Done becomes a task titled `<id> <name>`, spec = the Delivers text, kind `build`, unassigned, labels `checklist` and `checklist:<id>`. Within a phase each task needs the task of the nearest earlier row that has one (new or already on the board), so the existing needs mechanism turns waiting tasks ready by themselves. Returns `{ created: Task[], skipped: { row, title, reason: done | exists, taskId }[] }`.
- **Repeat-safe.** A row whose `checklist:<id>` task already exists in that channel is skipped. The import locks the channel row (`FOR NO KEY UPDATE`) for its transaction, so two imports at once make each task exactly once. A repeat that creates nothing writes no event.
- **Tick.** The board cannot write to a repo, so ticking is local: `flockr checklist sync <file> --channel <c>` lists the channel's tasks and rewrites the Status cell of each row whose task is done, and not already Done in the file, to `Done (task #<id>)`. Every other byte of the file stays as it was; a second sync changes nothing.

Out: a repo per channel (3d), writing to a repo from the server, assigning imported tasks, deleting tasks for rows removed from the file, a schema change (labels carry the row id).

## Surfaces

| Surface | What |
|---|---|
| API | `POST /api/channels/{channel}/checklist`, operationId `importChecklist` |
| MCP | `importChecklist`, generated from the same document |
| CLI | `flockr checklist import <file> --channel <c>`, `flockr checklist sync <file> --channel <c>` |
| Web | "Import checklist" on a channel's Tasks view: paste the markdown into a dialog; a toast says how many were made and skipped |

Sync has no route, MCP tool or web control on purpose: it edits a file on the caller's disk. It is built from `listTasks` and the shared `doneTasksByRow` and `tickChecklist`.

## Events

Each task writes `task.created` as any new task does, plus one `checklist.imported` event (`created` ids, `skipped` row ids) when the import made something.

## Rules the tests hold (`apps/server/test/checklist.test.ts`)

- The master checklist (a fixture copy in `apps/server/test/fixtures/`) parses into all 28 rows with phase, delivers, status and Done.
- Each imported task needs the one before it in its phase; finishing it readies the next.
- Two imports at once and a third later make each task once; a row added later needs the existing task before it.
- Sync changes only the Status cells of rows whose task is done, and is a no-op the second time.

## Exit checklist

- [x] Parser in `packages/contracts`, one definition
- [x] Route, `bun run generate`, MCP tool
- [x] `flockr checklist import|sync`
- [x] Web dialog on the Tasks view
- [x] Tests for the four rules above; `bun run check` passes
- [x] Board skill and web README updated

## Notes from the build

- No schema change: the row id lives in the `checklist:<id>` label, and repeat-safety is a channel-row lock plus a label lookup inside the same transaction. A unique index on (channel, row id) would be stronger; it needs a migration and can come later.
- The lock is `FOR NO KEY UPDATE`, not `FOR UPDATE`: a `FOR UPDATE` on the channel would block every other task or message insert into the channel (their foreign keys take `KEY SHARE`) for the length of the import.
- The Phase table header names the columns, so a checklist with extra or reordered columns still parses; without a header the Status is the last cell.
- A row that is Done in the file but already has a task is reported as `exists`, not `done`, and still anchors the chain for the rows after it.
- The Import checklist button is hidden below the `sm` breakpoint: the header has no room at phone width, and pasting a whole checklist is a desk task.
