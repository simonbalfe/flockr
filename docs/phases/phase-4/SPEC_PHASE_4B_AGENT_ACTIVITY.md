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

**Out:** pause (see Notes), mapping Claude Code's partial messages (`--include-partial-messages`, live text while a block streams), test-run parsing into a `tests` part, a second entry once one holds 200 parts.

## Schema

None. The route reads `messages` rows of kind `activity` by author.

## Rules the tests hold

- A sample Claude Code `stream-json` transcript becomes the expected updates in order, and the shared reducer accepts every one (`apps/runner/test/claude-code-activity.test.ts`).
- The final answer is not repeated as a step, and a subagent's own lines stay out of the parent's entry.
- An entry never receives more than 200 parts from the mapping.
- Steps a harness reports reach the entry in batches, all before the entry is finished (`runner.test.ts`).
- An agent's recent runs list only its own entries across threads, newest first, up to the limit; an unknown agent is a 404 (`apps/server/test/activity.test.ts`).

## Exit checklist

- [x] The Claude Code adapter fills its entry with steps; the runner core stays harness-agnostic.
- [x] `listAgentActivity` on every surface; `bun run generate` run.
- [x] The agent panel shows the current task, questions waiting and recent runs.
- [ ] Pause: left out, needs a schema change (Notes).
- [x] `bun run check` passes (server 57, runner 101, web 6).

## Notes from the build

- **Pause is left out because it needs a migration.** `agents.desired` has a check constraint, `in ('running', 'stopped')`, so a third state means a new migration, and another builder owns migrations right now. Rejected: a version with no migration that reads pause from the latest `agent.paused` or `agent.resumed` event: the events table has no index on `type`, so every heartbeat would scan the log, and moving to a column later would reverse where the truth lives. The shape to build: add `paused` to `agentDesiredStates` and to the check constraint (one migration), routes `pauseAgent` and `resumeAgent`, and an `agent.paused` event. The runner then treats a paused agent as having no room: its current run finishes, steers still reach it, mentions wait in its queue, ready tasks stay ready, and resuming drains the queue (`nudge`).
- Small choices made here, all easy to reverse: assistant text that more work follows shows as a finished `reasoning` part, because there is no text part type, and the last text before `result` is held back because it becomes the reply. Edits add to one `files` part with line counts and a diff built from the edit's old and new strings, which has no line numbers. Steps are sent every half second, the rate the guide suggests.
- A failed batch is logged and dropped, not retried with its revision. A lost step is cosmetic, and the entry still finishes.
- The built-in agent (`pi-durable`) still posts its tool steps from its own hooks and ignores `SessionSpec.activity`. Moving it onto the callback would give one path for both harnesses.
- Not checked in a browser: `do-verify` runs only when Simon asks, and this build had to keep off port 5173 and the dev board. Typecheck and the tests above cover the panel's data, not how it looks.
