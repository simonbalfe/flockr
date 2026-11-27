# 0032: Worker sessions are saved as one chunk per turn in the bucket, behind a fenced Postgres pointer

Status: accepted, 27 Nov 2026. Work: pl5-session-chunks. Decided by Simon in chat. Supersedes in part [0018](0018-durable-objects-are-disposable.md): its "copy the new `pi_` rows to Postgres after each step" part. The rest of 0018 stands: no data lives only in a Durable Object, and no board rules run in one.

## Problem

ADR 0018 had the agent object copy every saved Pi step into Postgres tables in the background. That puts the harness's private storage format into the board's schema, costs a Postgres write per step, and only covers Pi. Claude Code, which clients run on their own machines, keeps its transcript in its own session file, so a lost machine lost the conversation. Every agent is a worker, whatever its harness; each needs the same way to save and restore its session.

## Options

| Option | Good | Cost |
|---|---|---|
| Copy each step's `pi_` rows into Postgres (0018) | One store | A board table per harness format, a write per step, Pi only |
| **The harness saves locally during a turn; at turn end the adapter sends the new steps as one chunk; the board writes it to the bucket and appends it to a Postgres pointer row** | One route for every harness; Postgres holds a small pointer, the bucket the bytes; per-turn writes only | Up to one turn of steps exists only on the worker until the turn ends |
| Sync the whole local store to the bucket on a timer | No adapter code | Large uploads, no turn boundary, races between two workers |

## Choice

- **During a turn** the harness writes only to its own store (Pi Durable's SQLite, Claude Code's session file). Nothing per step goes to Postgres.
- **At each turn end** the runner's harness adapter takes the new steps as one chunk and sends it through one route, `saveSessionChunk`. The board stores it create-only (`If-None-Match: *`) at `sessions/<agent>/<session>/<fence>/<turn>`, **then** in one transaction appends it to the session's row in `session_pointers` and writes a `session.saved` event, checked against the fence.
- **Fence.** A session working a claimed task is fenced by that claim (`claim-<task>-<epoch>`): a save after the claim moves or expires is refused. Otherwise it is fenced by the session epoch on the pointer row (`session-<epoch>`). `openSavedSession` without a claim bumps the epoch; a worker opens a session once, the first time it saves or when it restores, so a restoring worker fences out the old one. The row holds the one fence that may save; any other is refused (`stale_claim`). A pointer starts as `unopened`.
- **Repeat-safe.** Sending a saved turn again with the same bytes changes nothing (`saved: false`, no event). Other bytes under a used key, in the bucket or in the pointer, are refused (`already_exists`); a turn number past the next is refused (`wrong_state`).
- **Restore.** A worker with no local state opens the session (bumping the epoch), reads the pointer's chunks in turn order, rebuilds its store and resumes. An orphan chunk (in the bucket, never added to the pointer, for example after a crash between the two writes) is never read; the next save under a new fence uses a new key.
- **Opaque chunks.** The board never reads a chunk. Only the adapter does, and applying a chunk twice must give the same state, because a crash between the outbox write and the adapter's own bookmark can resend steps. Pi: the changed and deleted rows of its SQLite tables since the last chunk (`pi-rows/1`, gzip JSON). Claude Code: the session file's new complete lines and the byte offset they start at (`claude-jsonl/1`).
- **Capability, not names.** An adapter declares `chunks` with `saving: "always"` or `"when-allowed"`. Pi is `always`. Claude Code is `when-allowed`: it saves only when the runner config has `saveSessions: true` (off by default, because it is the client's code leaving their machine).
- **Session identity.** The adapter picks it: Pi saves one session per agent (`agent`, session-fenced, since one SQLite file holds every thread); Claude Code saves one per harness session id, with its thread and claim. A runner that has no stored session for a thread asks the board for the newest saved one (`listSavedSessions?thread=`).
- **What stays put.** Board facts (tasks, claims, messages, activity, cost) stay in Postgres unchanged. Code stays on the task's git branch.
- **Local and tests.** With `FLOCKR_S3_*` unset the Bun server keeps chunks in a local folder (`FLOCKR_OBJECTS_DIR`, default `~/.local/share/flockr/objects`); tests use the in-memory store. The Worker without a bucket refuses saves.

## Why

One small, harness-neutral contract covers every worker. Postgres keeps only what needs a transaction: the ordered list and the fence. The bucket holds bytes cheaply and is already where backups go (0023). The fence reuses the claim rule the board already has, so two workers can never interleave one session's history.

## Costs

- The steps of a turn in progress live only on the worker; a crash mid-turn loses that turn's steps (Pi resumes the turn from its own store when the machine comes back).
- Claude Code transcripts leave the client's machine once `saveSessions` is on; that is why it is off by default.
- Chunks are never deleted by the board. The cleanup rule (delete `sessions/` objects some days after their task ends) is a bucket lifecycle rule for Simon to set; until then the bucket grows.
- The Pi chunk diff reads every row of the agent's SQLite file at each turn end and keeps a ledger of row hashes beside it; fine for one agent's history, to revisit if a file grows large.
- The Pi Durable Object of 0018 (one per cloud agent) is not built here; when it comes with 4c it saves through the same adapter and route.
