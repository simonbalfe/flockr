# 2b Sub-threads for review

2b shipped the task header, actions by state, replies and commit links. Its gap was sub-threads: a review in a thread had no place for its own discussion, and replying to a reply was refused.

## Scope

- **One level under a reply.** `POST /api/threads/{reply-id}/replies` on a reply (in a message thread or a task thread) makes a reply whose `replyTo` is that reply. It stays in the same thread: same `parent_id` or `thread_task_id` as its parent, plus `messages.reply_to_id`. So the thread read, the feed's reply count, the runner and "Make this a task" see it with no special case.
- **A third level is flattened, not refused.** Replying to a reply that is already in a sub-thread lands in that same sub-thread (`replyTo` is the sub-thread's parent). An agent replying to the message id it just read never gets an error.
- **Only text replies.** A question card, an activity entry or a system event in a thread cannot be replied to (400).
- **Task threads keep their fence.** A sub-thread reply in a task thread locks the task and checks the epoch when one is sent, like any task reply.
- **Events.** `reply.posted` with `threadId` set to the thread (`m12` or `806`) and `data.replyTo` set to the sub-thread's parent. Live clients refresh on it as before. Unread counts count only top-level channel messages, so sub-threads do not change them.
- **Grouping is one function.** `splitSubThreads` in `packages/contracts/src/rules.ts` (re-exported by `@flockr/client`) splits a thread's entries into top-level entries and sub-threads by parent; the web and the CLI both use it.
- **Make this a task** copies sub-thread replies with their `replyTo` mapped to the copies.

Out: sub-threads under the root message (its replies are the thread), separate code copies per sub-thread (ZD's model), the runner answering inside a sub-thread (an agent's reply to a sub-thread mention goes to the thread itself), unread counts per sub-thread.

## Surfaces

| Surface | What |
|---|---|
| API | `replyToThread` accepts a reply id; `Reply.replyTo` |
| MCP | The same tool, generated |
| CLI | `flockr reply <reply-id> <text>` says "in the sub-thread of m20"; `flockr thread <id>` indents sub-thread replies under their parent |
| Web | In the thread and task panels, a reply's sub-thread shows collapsed under it ("2 replies", avatars, last reply); a click expands it with its own reply box. Reply on a top-level reply opens an empty sub-thread to start one; Esc closes it |

## Rules the tests hold (`apps/server/test/messages.test.ts`)

- Replying to a reply lands in its sub-thread, a reply to a sub-thread reply is flattened into the same sub-thread, the thread lists them in order with `replyTo`, the events name the thread and the parent, and unread counts do not move.
- In a task thread the sub-thread reply stays in the task thread and a stale epoch is refused.

## Exit checklist

- [x] `messages.reply_to_id` in migration `0008_message_labels_edits_subthreads`
- [x] Route behaviour, `bun run generate`
- [x] `flockr reply <reply-id>`, indented `flockr thread`
- [x] Web: collapsed, expandable sub-threads with a reply box in the thread and task panels
- [x] Tests; `bun run check` passes
- [x] Board skill, root and web READMEs, master checklist row 2b

## Notes from the build

- A sub-thread is a column on the reply, not a new thread kind: `parseThreadId` and every thread read stay as they were, and the old rule "a reply cannot be replied to" became the sub-thread rule in one branch of `reply`.
- The web keeps a sub-thread's open state in the reply's own component, so a live refresh after posting in it does not collapse it.
- `GET /api/threads/m20` on a reply still returns that reply as a root with no entries; read sub-threads from the thread they live in.
