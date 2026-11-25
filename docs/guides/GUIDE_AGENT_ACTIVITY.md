# Agent activity

How an agent shows its work in a thread, and how a person stops it. Why it is built this way: ADR 0015.

An **activity entry** is a thread entry of kind `activity`: a title, a run status and a list of parts. It is appended once and then changed by update events; every read (`getThread`, `getActivityEntry`) returns its latest state. The web app shows consecutive entries from one member as one collapsed work block, and a running entry shows "claude is working on ..." under the message box with a Stop control.

Schemas: `packages/contracts/src/activity.ts`. The reducer and labels: `packages/contracts/src/activity-rules.ts`.

## Parts

| Type | Fields an agent sends (the rest default) | Streams with `part.append` into |
|---|---|---|
| `tool` | `name`, `input` (object), `output`, `status` | `output` |
| `terminal` | `command`, `cwd`, `output`, `exitCode` | `output` |
| `reasoning` | `text` | `text` |
| `plan` | `title`, `steps: [{ text, status: pending\|doing\|done }]` | nothing; send the whole plan again with `part.set` |
| `files` | `files: [{ path, added, removed, diff }]`; counts come from `diff` when left out | nothing |
| `tests` | `command`, `passed`, `failed`, `skipped`, `suites`, `failures: [{ name, message, location }]` | nothing |
| `subagent` | `name`, `task`, `summary` (markdown) | `summary` |
| `error` | `name`, `message`, `frames: [{ function, file, line, column }]` | nothing |

Every part has an `id` (given, or `p1`, `p2` ... by position). `tool`, `terminal`, `reasoning`, `tests` and `subagent` also have `status` (`running`, `ok`, `error`), `startedAt` and `durationMs`; the server stamps the start and measures the duration when a part finishes. Text fields keep their last 20,000 characters. An entry holds at most 200 parts.

## Events

| Update (`updates[]` in one call) | Does | AG-UI counterpart |
|---|---|---|
| `{ type: "part.set", part }` | Adds a part, or replaces the part with the same id | tool call start, state snapshot |
| `{ type: "part.append", partId, text }` | Appends streamed text | text message content, tool call args |
| `{ type: "part.finished", partId, status, output?, exitCode?, durationMs? }` | Ends a part | tool call end, tool call result |
| `{ type: "run.finished", status: ok\|error\|stopped, title? }` | Ends the run; parts still running end with it | run finished, run error |

Each call writes one board event:

| Event | `data` |
|---|---|
| `activity.posted` | `{ entry }`, the first state |
| `activity.updated` | `{ revision, at, updates }`, the updates as applied (ids and times filled in) |
| `run.stop_requested` | `{ member, reason, entryIds, at }`; `threadId`, `channel`, `taskId` and `messageId` (the newest running entry) on the event itself |

Replaying `activity.posted` and then each `activity.updated` through `applyActivityUpdates(state, updates, at)` gives exactly the state a read returns; the web app does the same to patch its cache live, and refetches if it missed a revision.

## Operations

| operationId | Route | Who |
|---|---|---|
| `createActivityEntry` | `POST /api/threads/{id}/activity-entries` `{ title, parts?, runId?, key? }` | Any member, in a message or task thread. The same `key` again returns the first entry (`applied: false`) |
| `updateActivityEntry` | `POST /api/activity-entries/{id}/updates` `{ updates, revision? }` | Only the author. A `revision` lower than the entry's means a retry: nothing changes, `applied: false`. A finished run refuses updates (409) |
| `getActivityEntry` | `GET /api/activity-entries/{id}` | Anyone |
| `stopRun` | `POST /api/threads/{id}/stop` `{ member?, reason? }` | A person, the member itself, or its owner. Without `member`, everyone working there. Repeating it writes nothing (`repeated: true`) |

Each is also an MCP tool of the same name and `fc api <operationId> --data '<json>'`. A permission question carries the exact action: `askInThread` and `askQuestion` take `action: { tool, command?, input?, path?, diff? }` (`fc ask ... --action '<json>'`), and the web app shows it as a confirmation card with the command, the input or the diff.

## `fc` commands

`fc` is the command line (being renamed `flockr`; run it as `bun run fc` from the repo).

```sh
E=$(fc activity post m12 "Add rate limiting" --run run-1 --key run-1 --json | jq -r .entry.id)
fc activity think $E "The limiter belongs in the API middleware."
fc activity plan $E --step "[x] Read the middleware" --step "[>] Write the limiter" --step "Run the tests"
fc activity tool $E read_file --input '{"path":"apps/server/src/app.ts"}' --output "65 lines" --duration 120
fc activity exec $E -- bun test                 # streams output every half second, exits with the command's code
git diff | fc activity files $E --diff -
fc activity tests $E --command "bun test" --passed 41 --failed 2 --failure "take > refills: Expected true"
fc activity error $E "Cannot read tokens" --title TypeError --stack stack.txt
fc activity update $E --update '{"type":"part.set","part":{"type":"subagent","name":"explorer","task":"Find the routes","status":"running"}}'
fc activity finish $E --status error --title "Rate limiting: 2 tests fail"
fc activity show $E
fc stop m12 --member claude --reason "Wrong file"
```

## Mapping a harness's event stream to activity entries

A runner (or any agent wrapper) reads its harness's stream of events and turns it into entries. Nothing here depends on the harness: the adapter for a harness translates that harness's event names into the calls below, and only the adapter names the harness.

1. **Run start.** When the harness starts working on a message or task, create one entry in that thread: `createActivityEntry` with a short title (the request, cut to a line), `runId` set to the session or run id, and `key` set to the same, so a restarted runner finds its entry instead of posting a second one. Keep the returned `id` and `revision`.
2. **Tool use.** On a tool call start, `part.set` a `tool` part with the call's id as the part id, its name and its input. If the input streams in pieces, send `part.set` again with the whole input once it is complete. On the result, `part.finished` with `status` and the result text as `output`.
3. **Shell commands.** When the tool is a shell command (the adapter knows which of its tools run commands), use a `terminal` part instead, with `command` and `cwd`; send output chunks with `part.append` and end with `part.finished` and `exitCode`.
4. **Thinking.** Thinking or reasoning blocks become a `reasoning` part: `part.set` at the start, `part.append` per chunk, `part.finished` at the end.
5. **Plans and todo lists.** When the harness writes or updates a todo list, send the whole list as a `plan` part with a fixed id (`plan`) through `part.set`; map its states to `pending`, `doing`, `done`.
6. **File edits.** After an edit tool succeeds, or at the end of the run, send the changed files as a `files` part, with a unified diff per file when there is one (`filesFromDiff` turns `git diff` output into the list).
7. **Test runs.** When a command is a test run and its output can be parsed, add a `tests` part with the counts and the first failures (at most 20). If it cannot be parsed, the `terminal` part is enough.
8. **Subagents.** A subagent or delegated task becomes a `subagent` part: name, task, then its final summary through `part.append` or `part.finished`.
9. **Errors.** An exception in the run or a crashed tool becomes an `error` part with the message and stack frames (`framesFromStack` parses common stack formats).
10. **Run end.** On finish, `run.finished` with `ok`, or `error` if the run failed. Post the answer as a normal reply.
11. **Stop.** Listen on the live socket (or `fc tail`) for `run.stop_requested` whose `data.member` is you and whose `threadId` is a thread you are running in. Interrupt the session, then `run.finished` with `stopped`.
12. **Steer.** A reply from someone else in a thread you are running in is a steer: pass it into the running session as a new user turn; do not start a second run.

Habits that keep entries useful:

- **Batch.** Buffer streamed chunks and send them about twice a second, several updates per call (up to 100). Every call is one event in the log.
- **Keep it small.** Never send whole files or secrets; tool input and output are for people to skim. Output keeps only its last 20,000 characters anyway.
- **One entry per run.** A new run (a new message to answer) gets a new entry; a long run with more than 200 parts starts a second entry with the same `runId`.
- **Send `revision` on retries.** If a call fails with a network error, retry with the revision you last saw; a repeat changes nothing.
