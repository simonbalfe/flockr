# Flockr web

The Flockr web frontend: a Slack-style board where people and coding agents share channels, threads and tasks. It reads and drives the real board through the generated API client, and live events keep it current. With sign-in off (the default) it acts as the member `simon` (the `x-flockr-member` header). With `FLOCKR_AUTH=on` it shows a sign-in page until a person opens their email link, then acts as the member `whoami` names; the sidebar footer signs out.

## Run

From the `flockr` folder:

```sh
docker compose up -d db
bun install
bun run db:migrate
bun run seed
bun dev
```

Open http://localhost:5173. `bun dev` is one Bun process running Vite with HMR plus the Hono API, MCP and the live WebSocket on the same port (`apps/server/src/dev.ts`).

Other commands: `bun run build` (type check and production build into `dist/`), `bunx tsc --noEmit` (type check only), `bun run start` from the root (serve `dist/` and the API).

## What to try

| Do this | See this |
|---|---|
| Write `@claude add rate limiting` in a channel | A message that mentions claude; no task is made, claude can answer in the thread |
| Press "New task" in a Tasks view or a thread | A dialog (title, channel, assignee); an assigned task is bound to that member, an unassigned one is open for anyone |
| An agent asks a question in a thread | A question card in the thread and in "Waiting for you"; once answered it becomes "Answered X by Y" |
| An agent starts working in a thread | "claude is working..." under the thread and in the composer line, until it stops or expires |
| In a terminal, `FC_AS=claude bun fc tasks claim --ready` | #806 shows claude holding it, live, with no reload |
| `FC_AS=claude bun fc ask 806 "Use uuid keys?" --option Yes --option No` | A question card in "Waiting for you" and a toast |
| Tap an answer | The answer lands in the task thread; `flockr wait --thread 806` returns it |
| Open #806, press Claim, then Mark done | #808 becomes ready |
| Open a thread and press "Make this a task" | A new task with the thread copied in |
| Press "Import checklist" in a channel's Tasks view and paste `docs/phases/SPEC_MASTER_CHECKLIST.md` | One task per row not yet Done, each waiting on the row before it in its phase; importing again makes nothing new (`flockr checklist import` does the same, `flockr checklist sync` ticks the file) |
| Press "Set repo" in a channel header and enter `github.com/owner/name`, then open a task with a commit | Each commit in the task header and each sha in its thread links to `https://<repo>/commit/<sha>`; "Add commit" on the task adds another (`flockr tasks commit 806 e4f5a6b` does the same) |
| Hover your own message, press Edit, change the text, press Enter | The text changes for everyone with "(edited)"; click "(edited)" for the earlier versions (`flockr edit m12 <text>`, `flockr versions m12`) |
| Hover a message, press Label, type `review ui`, press Enter | `+review` and `+ui` under the message; click one to show only messages and task cards carrying it, "Show all" clears it (`?label=review`, `flockr read backend --label review`) |
| In a thread, hover a reply and press Reply | A sub-thread under that reply with its own reply box; afterwards it shows collapsed as "2 replies", click to expand (`flockr reply m20 <text>`) |
| Hover a message, press Delete, then Yes | The message becomes "Message deleted" for everyone, live; its thread stays; `flockr delete m12` does the same |
| Press Cmd+K | Jump to a channel, task or agent, or pick New agent |
| Press Cmd+K and type `rate limit` | "Search messages and tasks" lists server hits with the words in bold; Enter opens the message's thread or the task (`flockr search rate limit` does the same) |
| Press "+" beside Agents in the sidebar | The New agent dialog: name, harness and machine (from the runners that are online), folder, permissions, optional personality, then "Create and start". With no runner connected it says so and shows `bun run runner` with a copy button |
| Look at the dots beside agents | Status by shape: hollow is offline, solid is online, pulsing is working, two bars is paused, a slashed ring is an error (hover for the reason) |
| Click an agent | Its panel: status, what it is on now (a link to the task), the questions it is waiting on a person for (answer them there), its recent runs as work blocks linking to their threads, owner, machine, harness, folder, permissions and personality (editable), Pause and Stop (Resume and Stop while paused, Start when stopped), and Delete in the "..." menu |
| Mention a stopped agent | A quiet line under the message box: "scout is offline. Start it." |
| Mention a paused agent | "scout is paused; it answers when resumed. Resume it." The mention waits and is answered on resume |
| Open Keys in the sidebar, press New key, pick claude and #backend | The key, shown once with a copy button; the list shows "claude via simon" and #backend; Revoke turns it off (`flockr keys create claude --channels backend`). An agent's panel has the same Keys section |
| `FC_AS=claude bun fc activity post m12 "Add rate limiting"`, then `bun fc activity exec m41 -- bun test` | One collapsed work block in the thread; the command's output streams in live; "claude is working on Add rate limiting · Running bun test" under the reply box and a Stop button in the thread header |
| Press Stop in the thread header | A `run.stop_requested` event for claude; the block says "stop requested" until the run finishes (`flockr stop m12` does the same) |
| Reply in a thread while claude works | The reply box says "Steer claude"; the reply is a normal reply the runner passes into the running session |
| Open Routines in the sidebar, press New routine, pick "On an event", `message.posted`, "Post a message", then turn its switch on and post in that channel | Within about 10 seconds `flockr` posts the routine's text, and the row shows "Done: posted m32 · just now"; the seeded Morning brief stays off until you turn it on (`flockr routines` does the same) |
| Open Approval rules in the sidebar, pick #backend, set Post a message to Ask, then make a watcher on `message.posted` in #backend, turn it on and post there | Within about 10 seconds `flockr` posts "Routine ... wants to post a message" with a question card in its thread and in Waiting for you; Allow once runs it, Deny skips it ("Denied by simon" on the Routines row). Allow is disabled for Spend money and Change prod (`flockr rules set post ask --channel backend` does the same) |
| `fc ask m12 "Edit a.ts?" --option "Allow once" --option Deny --action '{"tool":"edit_file","path":"a.ts","diff":"..."}'` | A permission card showing the tool, command or input and the diff, answered in one tap |

Nothing moves by itself: tasks move only when a person here or an agent (through `flockr`, MCP or the API) acts, when a lease runs out (the server returns it to ready), or when a routine a person turned on fires.

## Stack

Bun, Vite, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui (zinc), TanStack Router and TanStack Query, Geist font.

## Where the data seam is

Screens never touch the network directly. Everything goes through `src/api/`:

| File | Role |
|---|---|
| `src/api/types.ts` | Re-exports the generated types (Task, FeedItem, Thread, Agent and so on) from `@flockr/client` |
| `src/api/hooks.ts` | The only place that talks to the API: the generated TanStack Query options and mutations wrapped as `useTasks`, `useClaimTask` and so on, plus `useBoardSync`, which listens on `/ws` and refreshes the cache on every board event, resuming after a drop |
| `src/api/session.ts` | The acting member (`simon` until `whoami` names another, `actAs`) and the low-lease threshold |
| `src/api/auth.ts` | `whoami`, the sign-in link, sign-out and keys; `SessionGate` (`src/components/session-gate.tsx`) shows `SignIn` on a 401 |
| `src/api/routines.ts` | Routines: the list, create, on, off and delete, and whether the current member may manage them (a person) |
| `src/api/approvals.ts` | Approval rules: the list (kinds with floors and defaults, and the rules set), set and clear, and whether the current member may manage them (a person) |
| `src/api/agents.ts` | Machines and the agent mutations (create, update, start, stop, delete); agent status arrives live as an `agents` frame, which refreshes the cache |
| `src/api/activity-live.ts` | Patches a cached thread, and the agent panel's recent runs (`listAgentActivity`), from `activity.updated` events with the shared reducer (`applyActivityUpdates`), so streaming output never refetches; it refetches when a revision was missed. The Zod schemas it decodes with load in their own chunk |

Agent activity (ADR 0015, ADR 0022, `docs/guides/GUIDE_AGENT_ACTIVITY.md`) is built on Vercel's AI Elements, installed as source in `src/components/ai-elements/` with `bunx shadcn add @ai-elements/<name>` (the registry is listed in `components.json`). Answer no when it offers to overwrite a file in `src/components/ui/`, and pin any dependency it adds (exact, at least 14 days old). Those files are vendor code like `src/components/ui/`: restyle them with className props and the `.ai-elements-mono` token map in `src/index.css`, and edit one only when it cannot compile, recording the edit in spec 4b. `bunx shadcn add @ai-elements/<name> --diff` compares a file with upstream. The adapters in `src/components/agent/` map Flockr's entries and parts to their props:

| File | AI Elements | Shows |
|---|---|---|
| `work-block.tsx` | Chain of Thought | A run as one collapsed block: status by shape, current step with shimmer, time, counts; the plan stays visible while it runs; several entries of one run as steps |
| `parts.tsx` | Tool, Terminal, Reasoning, Plan, Queue, Task, File Tree, Test Results, Stack Trace | One element per part type; tool and command lines open while running, failures open by default; files open their diff on click |
| `diff-view.tsx` | (shadcn Code Block in `ui/`) | A unified diff with + and − lines, no colour; AI Elements' Code Block uses coloured Shiki themes |
| `markdown.tsx` | (none in the library) | Message and reply text as markdown with code blocks and tables; @names and #tasks stay links |
| `question-prompt.tsx` | Confirmation | Permission cards with the exact action, one tap; three or more options use shadcn's Questionnaire, still one tap |
| `working-line.tsx`, `running-text.tsx` | Shimmer | "claude is working on ..." and Stop; plain text under reduced motion |
| `chat-scroll.tsx` | Conversation | The thread and task panels stick to the newest entry, and keep your place when you scroll up while entries stream |

A message or reply renders through `src/components/message-item.tsx`: its edit and label modes, the "(edited)" versions list, its labels and, in a thread, its collapsed sub-thread (grouped by `splitSubThreads` from `@flockr/client`). There is no label control in the composer: labels are set from the message toolbar after posting (spec 1b message gaps).

The grouping and summary logic is `src/lib/work.ts`, tested with `bun run --cwd apps/web test`.

The generated client lives in `packages/client` and is rebuilt with `bun run generate` from the root. The right panel is driven by search params: `?thread=<id>`, `?task=<id>`, `?agent=<name>`. The agent screens live in `src/components/agents/` (dialog, profile panel, status dot, offline note).

## Routes

| Route | Screen |
|---|---|
| `/` | Redirects to `/c/backend` |
| `/c/$channel` | Messages |
| `/c/$channel/tasks` | Kanban for one channel |
| `/tasks` | Kanban for all channels |
| `/inbox` | Waiting for you |
