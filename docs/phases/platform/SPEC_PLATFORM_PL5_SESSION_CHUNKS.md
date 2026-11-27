# PL5 Session chunks

Part of the Platform track ([README](README.md)); [ADR 0032](../../decisions/0032-worker-sessions-are-saved-as-chunks-in-the-bucket-at-turn-end.md), superseding in part [ADR 0018](../../decisions/0018-durable-objects-are-disposable.md). Needs PL4 (the bucket and its S3 store).

## Problem

A worker's session (its conversation and tool calls) lived only on its machine: Pi Durable's SQLite file, or Claude Code's session file. A wiped machine, or an agent moved to another machine, started from nothing. ADR 0018's plan, copying every Pi step into Postgres, tied the board's schema to one harness's storage. Decided by Simon, 27 Nov 2026: every agent is a worker whatever its harness, and each saves one chunk per turn through one route.

## Scope

- **Pointer table** `session_pointers` (migration `0018_session_pointers.sql`): one row per agent and session with its thread, session epoch, current fence, the claimed task (if any) and the ordered chunk list (turn, fence, bytes, sha256, saved at).
- **Object store:** `ObjectStore.create` writes only if the key is free (S3 `If-None-Match: *`, 412 means taken). `fileStore` (local folder, `FLOCKR_OBJECTS_DIR`, default `~/.local/share/flockr/objects`) when `FLOCKR_S3_*` is unset on Bun; `memoryStore` in tests; the Worker without a bucket refuses saves.
- **Routes** (tag "saved sessions"): `listSavedSessions`, `getSavedSession`, `openSavedSession`, `saveSessionChunk`, `readSessionChunk` under `/api/agents/{name}/sessions`. Only the agent itself opens and saves; the agent and people read. Events `session.opened` and `session.saved` (metadata only, never chunk bytes).
- **Save order:** fence pre-check, create-only put at `sessions/<agent>/<session>/<fence>/<turn>`, then one transaction that locks the pointer, checks the fence again, appends the chunk and writes the event.
- **Runner:** `src/sessions.ts` keeps an outbox per session in `~/.flockr/agents/<agent>/sessions/<session>/` and sends it in order; a stale fence drops the outbox and stops saving that session; a turn conflict re-opens once. The harness interface gains `chunks` (`saving: "always" | "when-allowed"`, `ready`) and `SessionSpec` gains `claim` and `saver`.
- **Pi adapter** (always on): one session per agent, `agent`, session-fenced. Chunk `pi-rows/1`: gzip JSON of the rows changed or deleted since the last chunk, from a row-hash ledger beside the SQLite file. Restore builds the file in place under a `.restoring` marker. Saved after every turn.
- **Claude Code adapter** (off until the runner config has `saveSessions: true`): one session per harness session id, fenced by the task's claim when it works one. Chunk `claude-jsonl/1`: the session file's new whole lines and their start offset. Restores the file before `--resume` when it is missing; a runner with no stored session for a thread resumes the newest one saved for it.
- **CLI:** `flockr sessions list [<agent>] [--thread id]`, `flockr sessions show <agent> <session>`. MCP gets the five tools from the same document.
- **Web app: skipped.** A saved session is machine state for restoring a worker, not something people act on; its size and turns show in the CLI, and the transcript people read is already the thread's activity entries. Revisit if people ask to browse transcripts.

**Out:** the Pi agent Durable Object (comes with 4c and saves through this route), deleting chunks (a bucket lifecycle rule, below), browsing transcripts in the web app.

## Rules the tests hold

`apps/server/test/sessions.test.ts`:

- A save under a stale fence is refused: a session fence after a restoring worker opens it, a claim fence after the claim is released.
- Sending the same chunk twice saves it once and writes one event.
- Different content for a used key is refused, whether the pointer lists it or only the bucket holds it.
- A restore reads the chunks in turn order across fences; a turn past the next is refused.
- An orphan chunk (in the bucket, not in the pointer) is ignored by a restore, and the next fence's save takes that turn.

`apps/runner/test/pi-durable.test.ts`: a wiped Pi agent rebuilds from its chunks and remembers the earlier turns.

## Steps for Simon

- [ ] Add an R2 lifecycle rule on bucket `flockr` for prefix `sessions/`: delete objects 30 days after creation (tasks rarely stay open longer; lower it if storage grows). A rule by task end needs a board job that lists a finished task's sessions and removes their prefixes; not built.
- [ ] Nothing to deploy for the Worker beyond the usual: it uses the `FLOCKR_S3_*` secrets backups already need.
- [ ] To try Claude Code saving on a machine: `"saveSessions": true` in that machine's `~/.flockr/runner.json`.

## Exit checklist

- [x] Migration written with `bun run db:generate`; client regenerated with `bun run generate`.
- [x] Routes with `operationId`, MCP tools from the document, `flockr sessions list|show`.
- [x] Pi saves every turn; Claude Code saves only with `saveSessions`.
- [x] Rule tests pass; `bun run check` passes.

## Notes from the build

- Building the restored file elsewhere and renaming it failed on macOS with `SQLITE_IOERR_VNODE` on the next open, even after closing every handle we opened (a plain bun:sqlite rename works, so something in the Pi storage path keeps the old file busy; not traced). So the Pi restore builds the file in place with a `.restoring` marker instead of building elsewhere and renaming; a leftover marker means "no local state" and the next start restores again.
- A Pi turn's prompt is matched to its board message to find the request id; a test that sends a prompt with no matching message gets the earlier turn's id and is answered from memory without a model call. Tests post the message first.
- Pi keeps every thread in one SQLite file, so its session is per agent, not per thread, and only a session epoch can fence it; Claude Code's session is per thread and takes the claim fence.
- Chunk formats must be safe to apply twice (row upserts, offset writes): a crash between the outbox write and the adapter's bookmark resends steps.
