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
| `listAgentActivity` | `GET /api/agents/{name}/activity?limit=5` | Anyone. The agent's newest entries across all its threads (at most 20), each at its latest state with `threadId` and `channel`; the agent panel's Recent work |

Each is also an MCP tool of the same name and `fc api <operationId> --data '<json>'`. A permission question carries the exact action: `askInThread` and `askQuestion` take `action: { tool, command?, input?, path?, diff? }` (`fc ask ... --action '<json>'`), and the web app shows it as a confirmation card with the command, the input or the diff.

## How the web app shows it

The web app renders entries with Vercel's AI Elements, installed as source in `apps/web/src/components/ai-elements/` (ADR 0022), through adapters in `apps/web/src/components/agent/`. Consecutive entries of one run are one Chain of Thought block, collapsed, with its status by shape and the current step shimmering. Each part type has its element:

| Part | Element |
|---|---|
| `tool` | Tool: name, status badge, input and output |
| `terminal` | Tool with a Terminal inside; ANSI colour codes are stripped |
| `reasoning` | Reasoning, open while it streams |
| `plan` | Plan with its steps as a Queue |
| `files` | Task with a File Tree; a file opens its diff |
| `tests` | Task with Test Results |
| `subagent` | Task |
| `error` | Stack Trace, built back from the frames |

A permission question is a Confirmation card; "claude is working" uses Shimmer; the thread panel scrolls with Conversation. Colours are mapped to the zinc tokens by `.ai-elements-mono` in `apps/web/src/index.css`. Adding a part type: a schema in contracts, then one case in `parts.tsx`, usually with one more installed element.

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
fc agents activity claude --limit 10           # claude's recent runs across threads, newest first
fc agents watch claude                         # follow claude's runs live: a line per step, how each ended, its replies
```

## Mapping a harness's event stream to activity entries

A runner (or any agent wrapper) reads its harness's stream of events and turns it into entries. Nothing here depends on the harness: the adapter for a harness translates that harness's event names into the calls below, and only the adapter names the harness.

**How the runner does it.** The runner core posts the entry (step 1), finishes it (step 10) and acts on stop (step 11). In between, each session gets a callback, `SessionSpec.activity(updates)`: the harness adapter turns its own stream into updates and hands them over, and the runner sends them in batches every half second (`apps/runner/src/activity.ts`), all of them before `run.finished`. The `claude-code` adapter maps its `stream-json` output in `apps/runner/src/harness/claude-code-activity.ts`:

| Claude Code line | Becomes |
|---|---|
| `thinking` block | a finished `reasoning` part |
| `text` block followed by more work | a finished `reasoning` part; the last text before `result` is the answer and only becomes the reply |
| `tool_use` of a command tool (`Bash`) | a `terminal` part with the folder as `cwd`; its `tool_result` ends it with the output and an exit code |
| `tool_use` of `TodoWrite` | the `plan` part (id `plan`), replaced on every write |
| `tool_use` of `Task` or `Agent` | a `subagent` part; its result becomes the summary. The subagent's own lines (`parent_tool_use_id` set) are left out |
| `tool_use` of an edit tool | a `tool` part, and on success the `files` part (id `files`) with the changed paths and line counts |
| any other `tool_use` | a `tool` part with the input (long strings cut to 2,000 characters); its `tool_result` ends it with the output (4,000) |
| `result` with `is_error` | an `error` part |

It stops adding parts at 200 per entry rather than starting a second entry. The built-in agent (`pi-durable`) posts its tool steps from its own hooks instead.

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
