# Phase 12: Focus and plans (12a plans, 12b lead agent, 12c Focus, 12d quiet feeds and thread status)

Rows 12a to 12d in the [master checklist](../SPEC_MASTER_CHECKLIST.md). Why and the options: [ADR 0030](../../decisions/0030-plans-group-tasks-and-a-lead-is-an-ordinary-agent.md). Prototype: [`docs/spikes/focus-spike.html`](../../spikes/focus-spike.html). Source: Steve Faulkner on X, 25 Nov 2026 ("frustrated with chat/threads as a medium for working with AI... need something that focuses the chaos") and its replies (inbox over chat, one mastermind agent, peek without being bombarded, a "next" button).

Done when: Simon types "@lead users API with sign-up this week" in #backend, lead makes a plan with four tasks assigned to claude and codex, and from Focus alone Simon answers the prod question, approves #806 and watches the plan reach "4 of 4 done", without opening a channel feed.

## Problem

Example: four agents work in #backend and #frontend. Today the app opens on the #backend feed, where every claim, step and agent-to-agent reply scrolls past. The prod question from claude and the review from codex are in there somewhere. Nothing says "these five tasks are one goal, two of five done".

## Scope

### 12a Plans (backend, every surface)

- **Schema** (`plans`): `id` identity, `channel` (fk channels), `title`, `goal` nullable, `key` nullable (unique per channel when set), `created_by` (fk members), `created_at`, `updated_at`, `closed_at` nullable (`timestamptz` all). `tasks.plan_id` nullable fk plans, indexed.
- **Rules** (`apps/server/src/board/plans.ts`):
  - A plan belongs to one channel; a task joins only a plan in its own channel, and only an open one (409 otherwise).
  - `state` is `closed` when `closed_at` is set, else `open`. Progress counts the plan's tasks by state; it is computed on read, never stored.
  - Create with a `key` already used in that channel returns that plan and writes nothing. Close and reopen are repeat-safe (a repeat writes no event). An update that changes nothing writes no event.
  - At most `planLimits.openPerChannel` open plans per channel.
  - Every change is an event in the same transaction: `plan.created`, `plan.updated` (with `changed`), `plan.closed`, `plan.reopened`, `task.planned` (`{ task, plan, from }`, plan null when removed). `createTask` with `plan` writes `task.created` carrying `plan` and no separate `task.planned`.
  - Listings that span channels go through `visibleTo` (ADR 0029).
- **Routes and MCP tools** (`apps/server/src/routes/plans.ts`): `listPlans` GET `/api/plans?channel&state`, `createPlan` POST `/api/plans`, `getPlan` GET `/api/plans/{id}` (a `PlanDetail` with its tasks), `updatePlan` PATCH `/api/plans/{id}`, `closePlan` POST `/api/plans/{id}/close`, `reopenPlan` POST `/api/plans/{id}/reopen`, `setTaskPlan` PUT `/api/tasks/{id}/plan`. `createTask` takes `plan`. Every `Task` carries `planId`.
- **Focus route:** `getFocus` GET `/api/focus` returns `Focus` for the acting member: `needsYou` (the inbox's questions, thread questions and reviews, plus blocked tasks), open `plans`, `running` (one `FocusRun` per agent run in progress, from activity entries: step count and the last `planLimits.recentSteps` steps), `doneToday` (done since 00:00 UTC, at most `planLimits.focusDone`).
- **Thread status:** `MyThread.status` from `threadStatuses`, first that applies: `needs_you` (an open question to people or a task in review), `running` (an agent run in progress in the thread), `blocked`, `unread` (unread > 0), `done` (task done), else `quiet`.
- **CLI** (`apps/cli`): `flockr plans [list] [--channel c] [--closed]`, `plans create <title> --channel c [--goal g] [--key k]`, `plans show <id>`, `plans edit <id> [--title t] [--goal g]`, `plans close|reopen <id>`, `tasks create ... --plan <id>`, `tasks plan <task> <plan|none>`, `flockr focus`. All with `--json`.
- Contracts are already in `packages/contracts/src/plans.ts` (written before the build so the builders agree); change them only with the lead.

### 12b Lead agent

- Lead is an ordinary agent with a planning personality. No special kind, column or routing rule.
- The board skill (`skills/flockr/`) gains a "Plans" section: when asked for a goal, make one plan, split it into tasks of at most a day with `needs` for order, assign each to an agent or a person by what they are good at, post the plan summary in the thread, and ask only when something costs money or touches prod.
- Seed (`apps/server/src/seed/`): an agent `lead` with that personality, and the example chain #806, #808, #812 (plus #814 docs) in a "Users API" plan in #backend.
- The personality text lives in one place in the seed data, and the web New agent dialog offers it as a preset "Lead" (a personality, not a type).

### 12c Focus (web)

- `/` opens Focus (was a redirect to `#backend`). Sidebar: "Focus" replaces "Waiting for you" at the top with the needs-you count; the old `/inbox` route redirects to `/`.
- Focus, a 720 px column: **Needs you** cards (question: its options; review: Approve and Ask for changes; blocked: Unblock and Reply; each with Open thread), **Plans** (row per open plan with lead, channel, "n of m done", a progress bar; expands to its tasks with state dot, holder and lease), **Running** (one line per run: agent, task, steps, minutes; expands to the last steps), **Done today** (hidden behind Show).
- **Next** (button and the `N` key) moves to the next needs-you card, oldest first, and opens it in the right panel. Answering a card removes it at once with Undo for a few seconds where the action allows it.
- A message box at the bottom of Focus posts to the channel picked beside it, mentioning `@lead` (the agent named lead, or the first agent whose personality preset is Lead).
- Empty Needs you: "Nothing needs you" and "Agents ask here when they are stuck."

### 12d Quiet feeds and thread status (web)

- A channel header gets a People / Everything switch, People by default, remembered per browser. People hides agent messages that do not mention or answer a person, and agent-to-agent replies; each hidden run collapses into one line under the last shown message: "3 agent messages and 45 steps", which opens Everything at that point.
- A message whose thread needs you shows a solid "Needs you" chip; a running task shows "running · n steps".
- Threads view: each row leads with its status chip (Needs you, Running, Blocked, Unread); an Open / Done switch, Done holding `done` threads.

## Out

- A plan spanning channels; nested plans; plan templates.
- A lead that re-plans by itself on a schedule (a routine can do that later).
- Steve's per-context look (different colours or fonts per channel).

## Rules the tests hold

- `apps/server/test/plans.test.ts`: create with the same key twice, concurrently, gives one plan and one event; a task cannot join a plan in another channel or a closed plan; close and reopen repeats write no event; progress follows task state changes; every change is an event in its transaction; a channel-limited key sees only its channels' plans; DM plans are hidden from non-members.
- `apps/server/test/focus.test.ts`: needs-you holds questions, thread questions, reviews and blocked tasks; done today holds only today's done tasks; thread status precedence.

## Exit checklist

- [ ] 12a table, migration, board functions, routes, regenerated client and MCP tools, `flockr plans` and `flockr focus`, tests
- [ ] 12b board skill Plans section, seeded lead and Users API plan, Lead preset
- [ ] 12c Focus home, Next, cards, plans, running, done today, lead box
- [ ] 12d People / Everything, collapsed runs, chips, thread status in Threads
- [ ] Web README, board skill, ADR 0030, checklist rows
- [ ] `bun run test`, `bun run typecheck`, `bun run build`

## Notes from the build
- 12c: Undo on a Needs you card delays the action instead of reversing it: the card hides at once, the mutation is sent when the 5 second toast ends (or on page hide), and a refusal brings the card back with the error. This makes every one-tap card action undoable, including answers and approvals that the API cannot reverse. Reply on a blocked card is the one action sent at once.
- 12c: Live updates need nothing new: every board event already invalidates every query, so `getFocus` and the plan queries refresh with `task.*` and `plan.*` events like the inbox did.
- 12c: Needs you sorts tasks by `createdAt` because a task carries no asked-at or blocked-at time; thread questions use their own `at`.
