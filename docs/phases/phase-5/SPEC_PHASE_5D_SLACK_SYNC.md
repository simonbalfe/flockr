# 5d Slack sync

A Slack channel and a Flockr channel stay in step: a message or reply on either side shows on the other, in the matching thread, and question and review cards show as Slack buttons a linked person can press (P50, P57). The Slack tokens live only in the server's settings; no agent ever holds one (ADR 0035).

## Scope

- **One chat bridge interface** (`apps/server/src/chat-bridges/bridge.ts`) with the Slack adapter first (`slack.ts`). Only the adapter names Slack. It uses the Chat SDK's Slack adapter (`@chat-adapter/slack` 4.45.0, released 13 Nov 2026, which pins `chat` 4.45.0) through its standalone parts: `/webhook` checks the signature and parses interactions, `/api` posts messages with a fetch Flockr passes in. The full `Chat` runtime is not used: Flockr's jobs table and hook deliveries already do its state, locks and retries (ADR 0035).
- **Off by default.** Nothing syncs until both `FLOCKR_SLACK_SIGNING_SECRET` and `FLOCKR_SLACK_BOT_TOKEN` are set and a person links a channel. Until the secrets are set, `/api/hooks/slack` answers 404.
- **Mapping**
  - A Flockr channel to a Slack channel (`bridge_channels`, one to one).
  - A Flockr thread (a top-level message `m12`, or a task `806`) to a Slack thread (`bridge_threads`, one to one).
  - A Slack user to a person (`bridge_people`, one to one). People only; agents stay on the board.
  - Each Flockr message that came from or went to Slack, with its Slack timestamp (`bridge_messages`), so nothing echoes back.
- **Slack to Flockr** (`POST /api/hooks/slack`, the Events API and interactivity URL):
  - The signature is checked first (`v0` HMAC, 5 minutes of clock skew); a bad one is refused with 401 and changes nothing.
  - Slack's `event_id` (or an interaction's `trigger_id`) is the request key in `hook_deliveries`; a retry answers `duplicate` and changes nothing.
  - A top-level message in a linked Slack channel becomes a top-level Flockr message and links the two threads. A reply in a linked Slack thread becomes a reply in its Flockr thread. A reply under a Slack thread that was never linked, bot messages, edits and other subtypes are ignored.
  - A linked person's message is posted as that person, through the same code as the API, so `@claude` wakes claude as it would from the web app. An unlinked Slack user's message is posted by the `slack` bridge member as `**Slack user U07ABC**: text`, with no mentions (Always: nothing acts unless asked).
  - A button press counts only when the Slack user is linked to a person who can see the card's channel, and the card's channel is linked to the Slack channel it was pressed in. It then runs the same board call as the API, as that person, so 13a (only a person or the named reviewer approves, never the submitter, at the shown commit) and 13d (a question addressed to a member waits for that member; permission cards need a person) hold unchanged. A refusal is sent back to the presser only, through Slack's `response_url`.
- **Flockr to Slack** (a `bridge` job per event, written in the event's transaction, drained by the scheduler):
  - `message.posted` (top level) posts a new Slack message and links the threads; `task.created` posts `#806 Title` and links the task's thread; `reply.posted` posts into the linked Slack thread.
  - `task.asked` and `question.asked` post the question with one button per option; `task.submitted` posts the review with an Approve button carrying the commit under review. Asking for changes stays in Flockr, since it needs reasons.
  - `task.answered`, `question.answered`, `task.approved` and `task.changes_requested` post one line saying who did what.
  - A message that already has a `bridge_messages` row (it came from Slack) is skipped. A reply whose Flockr thread was started before the channel was linked is skipped; one whose thread is newer but not on Slack yet waits for the root's job (retried).
  - The job key is `bridge:<bridge>:<event seq>`, so each event posts at most once per job.
- **Access** (`canSee`, ADR 0033): only a person in the host org links or unlinks a channel, and only a host-org channel of visibility `org` can be linked. Private channels (a Slack channel's members are not the Flockr channel's members) and shared channels (another org's messages would leave for our Slack) stay off Slack. A person links only their own Slack user id, and only host-org people can. Every `/api/bridges` route is board-scoped, so a client-org member or a channel-limited key gets 403 on all of them: agents never touch the bridge.

Out: Slack slash commands, modals, streaming agent replies, editing and deleting synced messages, files, reactions, sub-threads under a reply (Slack has none), Slack OAuth installs (one workspace, one bot token), several Slack workspaces, proving a Slack user id belongs to the person who links it (see Costs).

## Schema (migration 0030)

| Table | Key | Columns |
|---|---|---|
| `bridge_channels` | (`bridge`, `channel`); unique (`bridge`, `external`) | `linked_by`, `linked_at` |
| `bridge_people` | (`bridge`, `member`); unique (`bridge`, `external`) | `linked_at` |
| `bridge_threads` | (`bridge`, `thread`); unique (`bridge`, `external_channel`, `external_thread`) | `created_at` |
| `bridge_messages` | (`bridge`, `message`); unique (`bridge`, `external_channel`, `external_ts`) | `created_at` |

Events: `bridge.channel_linked`, `bridge.channel_unlinked` (on the channel), `bridge.person_linked`, `bridge.person_unlinked` (no channel; host org only). Job kind `bridge`.

## Routes and surfaces

| Route | operationId | `flockr` | Web |
|---|---|---|---|
| `GET /api/bridges` | `listBridges` | `flockr slack` | Settings, Slack |
| `PUT /api/bridges/{bridge}/channels/{channel}` `{ external }` | `linkBridgeChannel` | `flockr slack link <channel> <slack-channel-id>` | Link a channel |
| `DELETE /api/bridges/{bridge}/channels/{channel}` | `unlinkBridgeChannel` | `flockr slack unlink <channel>` | Unlink |
| `PUT /api/bridges/{bridge}/people/me` `{ external }` | `linkBridgePerson` | `flockr slack me <slack-user-id>` | Your Slack user id |
| `DELETE /api/bridges/{bridge}/people/me` | `unlinkBridgePerson` | `flockr slack forget` | Forget |

MCP tools come from the same operations. The `flockr` command and the Settings page are made for each name in `chatBridges` (`packages/contracts`), with the label the server sends, so neither names Slack in code. `POST /api/hooks/slack` is for Slack, not members, so it is not an OpenAPI operation.

## Rules the tests hold (`apps/server/test/slack.test.ts`, against a fake Slack)

- A retried Slack event (same `event_id`) changes nothing twice.
- A bad signature is refused (401) and changes nothing.
- An unlinked Slack user cannot answer a card; a linked one can.
- Nothing crosses orgs: shared and private channels cannot be linked, a client-org person cannot link or list anything, an agent cannot link, and nothing from a shared channel reaches Slack.
- A board reply reaches the linked Slack thread once, and a Slack reply is not echoed back.

## Set up (Simon)

1. Create a Slack app (one workspace). Bot scopes: `chat:write`, `channels:history`, `groups:history`. Event subscriptions: `message.channels`, `message.groups`. Interactivity on.
2. Request URL and interactivity URL: `https://flockr.simonbalfe.com/api/hooks/slack`.
3. `FLOCKR_SLACK_SIGNING_SECRET` and `FLOCKR_SLACK_BOT_TOKEN` in Infisical (`prod`) and as Worker secrets.
4. Invite the app to the Slack channel, then Settings, Slack: link the channel by its id, and each person enters their own Slack user id.

## Exit checklist

- [x] Spec, ADR 0035
- [x] Bridge interface and Slack adapter, migration, routes, generated client, MCP, `flockr slack`, Settings page
- [x] Tests against a fake Slack
- [ ] The Chat sync page seen in a browser
- [ ] A real Slack app and its secrets (Simon), then one message each way and one button press on the live board

## Costs

- Anyone can type any Slack user id. Linking someone else's id lets their Slack clicks act as you (only you are harmed), or squats their id so they cannot link it. Proving the id (Sign in with Slack, or a code the bot sends by DM) comes with the real app.
- Slack has no request key on `chat.postMessage`: a job that posts and then fails before it records the post would post again on retry. The record is written in the same transaction that finishes the job.

## Notes from the build

- The adapter's standalone parser returns channel `message` events as `unsupported` with the raw event, so `slack.ts` decodes them with Zod; interactions and URL checks come from the parser.
- An inbound message is written in one transaction with its request key, its `bridge_messages` row and, for a new thread, its `bridge_threads` row. The outbound job for the same event sees the `bridge_messages` row and skips it, so nothing echoes. A Slack reply by a linked person runs `replyIn` (the API's reply, split out of `reply` to take a transaction).
- Outbound jobs are enqueued next to watchers in `writeEvents`, only for events in a linked channel, keyed `bridge:<bridge>:<seq>`. `drainJobs` takes the bridge settings; `startLive` and the Worker's cron pass them.
- A button press records its request key first, then runs the board call; if the call fails, the presser presses again (a new key). Refusals go back through `response_url` and the hook still answers 200, as Slack wants.
- Slack-originated messages from linked people keep their mentions on purpose: the person asked. Unlinked authors post as `slack` with none.
- Tests run on their own database with `TEST_DATABASE_URL=.../flockr_test_5d` when another worktree shares the Postgres; the board reset truncates the four bridge tables too.
- Not checked in a browser: the Chat sync page was built to the existing Settings pages and typechecks, but no `bun dev` run, so as not to migrate the shared local database from a worktree.
