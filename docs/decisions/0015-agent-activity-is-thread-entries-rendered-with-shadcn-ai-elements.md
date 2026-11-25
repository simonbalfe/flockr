# 0015: Agent activity is thread entries rendered with shadcn AI Elements

Status: accepted, 24 Nov 2026; rendering with patterns copied in superseded in part by [0022](0022-activity-ui-is-built-on-installed-ai-elements.md). Builds on 0003 (every surface), 0009 (agnostic), 0010 (one contract) and 0012 (event log).

## Problem

Agents do long work in a thread (tool calls, commands, thinking, plans, test runs) and people see nothing until a reply lands. They cannot tell whether claude is stuck, what it is running, or stop it. Any agent, on any harness, must be able to show this, and the web app must render it without 40 loose cards per run.

## Options

| Option | Good | Cost |
|---|---|---|
| Replies with formatted text | Nothing new to build | Unreadable at length; no status, no live output, no structure to group |
| Live-only activity frames (like presence) | Cheap, no storage | Lost on reload; breaks the log-is-the-truth rule; nothing to replay |
| A new thread entry kind `activity`: appended once, changed by update events, reads return the latest state | Survives reload, streams live, replays from the log, any agent can post it through `fc`, MCP or the API | One more entry kind every surface handles; a jsonb state column on messages |
| A separate table of runs and steps | Normalised | Two orderings to merge with the thread; more joins on every read |

For rendering: shadcn AI Elements (Trace, Code Block, Message Scroller, Questionnaire, Item, Marker) copied into the project, or hand-built cards.

## Choice

- An activity entry is a `messages` row of kind `activity` in the thread, with its current state in a jsonb `activity` column. Its parts are a Zod discriminated union in `packages/contracts/src/activity.ts`: tool, terminal, reasoning, plan, files, tests, subagent, error.
- Updates are an event vocabulary shaped after AG-UI but our own: `part.set`, `part.append`, `part.finished`, `run.finished`. Each update call is one `activity.updated` event carrying the applied updates; `activity.posted` carries the first state. One pure reducer, `applyActivityUpdates` (`activity-rules.ts`), is used by the server to write, by tests to replay the log, and by the web app to patch its cache from the live socket.
- Only the author updates its entry. A `key` on create and a `revision` on update make retries change nothing twice.
- A running entry keeps its author shown as working through the existing presence (`setActivity`), refreshed at most every minute, and cleared when the run finishes.
- `stopRun` writes `run.stop_requested` for a member in a thread and marks its running entries; the member's runner acts on it.
- The web app renders a run as one collapsed work block built from the copied AI Elements patterns, made monochrome (failure by shape, never red).
- Markdown: `react-markdown` 10.1.0 with `remark-gfm` 4.0.1 for tables, and `remend` 1.4.0 to close half-finished markdown while text streams. Chosen over Streamdown (which wraps the same three plus Shiki, KaTeX and Mermaid, and whose caret ranges pulled a release published the same day) and over `marked` (HTML strings, so a sanitiser and `dangerouslySetInnerHTML`). react-markdown renders to React elements and escapes HTML by default.
- Diffs: no library. The first pick, `diff` (jsdiff) 9.0.0, threw on hunks whose line counts were off by one, which agents produce often; a 20-line lenient parser (`diffLines`) in contracts feeds Code Block's added and removed lines and also counts additions and removals.
- Code is shown without syntax colours: shadcn's Code Block highlighter uses Shiki with coloured themes, which breaks the monochrome rule, so Shiki was removed.

## Why

The log stays the one truth (reload, replay, `fc tail` all see the same run), and nothing names a harness: a runner, a script or a person with `fc` posts the same entries. Copying the patterns keeps the code ours and lets us strip colour and the AI SDK types they assume.

## Costs

- Streaming output writes one event per flush (about two a second from `fc activity exec`); a very chatty run grows the log. Output is capped at the last 20,000 characters per part.
- The web bundle gains about 230 KB (markdown); the Zod schemas for live decoding load in a separate chunk.
- `apps/runner` must map its harness stream to entries and act on `run.stop_requested` (the guide says how); until then only agents that post through `fc` or the API show activity.
- Questions with more than two options use the Questionnaire list (one tap still answers), which is taller than a button row.
