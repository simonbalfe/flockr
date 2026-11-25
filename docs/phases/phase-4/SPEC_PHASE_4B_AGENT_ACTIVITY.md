# 4b Agent activity

Row 4b in the [master checklist](../SPEC_MASTER_CHECKLIST.md): per-agent view (current task, recent steps, questions waiting), pause or stop from the web app, carried out by the launcher. Covers P30 and P72. Builds on [ADR 0015](../../decisions/0015-agent-activity-is-thread-entries-rendered-with-shadcn-ai-elements.md) (activity entries) and [ADR 0016](../../decisions/0016-agents-are-created-in-the-app-and-served-by-machine-runners.md) (agents served by runners). How entries work: [GUIDE_AGENT_ACTIVITY.md](../../guides/GUIDE_AGENT_ACTIVITY.md).

## Problem

A Claude Code run showed as one empty work block: the runner posted an entry and finished it, with nothing in between. The agent panel showed status and tasks but not what the agent had been doing or what it was waiting on.

Example: `@scout add rate limiting` gave "Worked for 2m" and no steps. After 4b the block lists "Thought", "Used Read", the plan, "Changed src/app.ts", "bun test exited with 1", and scout's panel shows that run and the question it is waiting on.

## Scope

- **Steps from the harness, mapped in its adapter.** `SessionSpec.activity(updates)` is a callback every session gets. The `claude-code` adapter maps its `stream-json` lines to entry updates in `apps/runner/src/harness/claude-code-activity.ts` (the table is in the guide). The runner core (`apps/runner/src/activity.ts`) batches them every 500 ms, up to 100 per call, and sends all of them before `run.finished`. The core never reads a harness's stream, so it names no harness.
- **Read route** `listAgentActivity`, `GET /api/agents/{name}/activity?limit=5` (at most 20): the agent's newest activity entries across all its threads, at their latest state. It ships on every surface: route and client, MCP tool, `flockr agents activity <name> [--limit n]`, and the panel.
- **Agent panel** (`apps/web/src/components/agents/agent-profile.tsx`): a "Now" row (working on or blocked on a task, as a link, or idle), "Waiting for a person" (open questions on its tasks and in its threads, from `getInbox`, answerable in place), and "Recent work" (its last 5 runs as work blocks, each linking to its thread). Streaming updates patch the recent runs live through `activity-live.ts`, the same reducer the thread uses.
- **Stop** was already built (`stopRun` and the Stop button in the thread, Stop on the agent panel); unchanged.
- **Pause** (added in `4a-herdr-and-pause`, Notes): `pauseAgent` and `resumeAgent`, `POST /api/agents/{name}/pause|resume`, people only; `flockr agents pause|resume <name>`; Pause and Resume on the agent panel; the status `paused`; the runner holds new work while paused.

**Out:** mapping Claude Code's partial messages (`--include-partial-messages`, live text while a block streams), test-run parsing into a `tests` part, a second entry once one holds 200 parts.

## Schema

None for activity: the route reads `messages` rows of kind `activity` by author. Pause adds `paused` to the `agents_desired` check (`apps/server/drizzle/0008_agent_pause.sql`).

## Rules the tests hold

- A sample Claude Code `stream-json` transcript becomes the expected updates in order, and the shared reducer accepts every one (`apps/runner/test/claude-code-activity.test.ts`).
- The final answer is not repeated as a step, and a subagent's own lines stay out of the parent's entry.
- An entry never receives more than 200 parts from the mapping.
- Steps a harness reports reach the entry in batches, all before the entry is finished (`runner.test.ts`).
- An agent's recent runs list only its own entries across threads, newest first, up to the limit; an unknown agent is a 404 (`apps/server/test/activity.test.ts`).
- Pause and resume are people only, write one event each, are safe to repeat and refuse a stopped agent; a paused agent shows `paused` (`apps/server/test/agents.test.ts`).
- A paused agent's running run finishes, a new mention waits and a ready task stays unclaimed; resuming starts the waiting conversation and claims the task (`apps/runner/test/service.test.ts`).

## Exit checklist

- [x] The Claude Code adapter fills its entry with steps; the runner core stays harness-agnostic.
- [x] `listAgentActivity` on every surface; `bun run generate` run.
- [x] The agent panel shows the current task, questions waiting and recent runs.
- [x] Pause and resume on every surface, carried out by the runner (Notes).
- [x] `bun run check` passes (server 57, runner 101, web 6).

## Notes from the build

- **Pause is a third desired state** (built in `4a-herdr-and-pause`). `paused` joins `agentDesiredStates` and the `agents_desired` check (migration `0008_agent_pause.sql`, which only widens the check). Rejected: a separate `paused` column, which would need clearing on every stop and start and would let a stopped agent be "paused"; and reading pause from the latest event, which would scan the log on every heartbeat. Moves are one lookup per action (`transitions` in `apps/server/src/board/agents.ts`): pause takes running to paused, resume takes paused to running, start takes either other state to running, stop takes either to stopped, and pause or resume on a stopped agent is a 409 `wrong_state`. Each move writes `agent.paused`, `agent.resumed`, `agent.started` or `agent.stopped`. Pause and resume keep the runner's last report, so a paused agent mid-run shows "Paused; finishing its current run" at once.
- **The runner keeps serving a paused agent and gives it no room** (`apps/runner/src/service.ts`): its run in progress finishes and steers still reach it, new mentions and replies wait in its queue, ready tasks assigned to it stay ready and unclaimed. On resume the service nudges it and it drains the queue, conversations first, then ready tasks, within `maxSessions`. A task it held before a crash is not adopted while paused, and is not adopted on resume either; its lease runs out and the sweeper returns it.
- A mention of a paused agent shows "scout is paused; it answers when resumed. Resume it." under the message box. The agent does not reply in the thread to say so.
- Small choices made here, all easy to reverse: assistant text that more work follows shows as a finished `reasoning` part, because there is no text part type, and the last text before `result` is held back because it becomes the reply. Edits add to one `files` part with line counts and a diff built from the edit's old and new strings, which has no line numbers. Steps are sent every half second, the rate the guide suggests.
- A failed batch is logged and dropped, not retried with its revision. A lost step is cosmetic, and the entry still finishes.
- The built-in agent (`pi-durable`) still posts its tool steps from its own hooks and ignores `SessionSpec.activity`. Moving it onto the callback would give one path for both harnesses.
- Not checked in a browser: `do-verify` runs only when Simon asks, and this build had to keep off port 5173 and the dev board. Typecheck and the tests above cover the panel's data, not how it looks.
