# 4c Cloud agents

Row 4c in the [master checklist](../SPEC_MASTER_CHECKLIST.md): an agent created in the app can live on the machine `cloud`. It wakes on mentions and on tasks assigned to it, takes a steer mid-run, keeps its memory between conversations, and runs with the laptop shut. Covers P39 and P40. Decisions: [ADR 0036](../../decisions/0036-a-cloud-agent-is-a-runner-of-one-inside-its-durable-object.md), building on [0008](../../decisions/0008-pi-durable-is-the-built-in-agent-harness.md) (Pi Durable), [0018](../../decisions/0018-durable-objects-are-disposable.md) (disposable objects), [0024](../../decisions/0024-the-board-is-the-model-key-proxy.md) (model proxy), [0032](../../decisions/0032-worker-sessions-are-saved-as-chunks-in-the-bucket-at-turn-end.md) (session chunks) and [0034](../../decisions/0034-a-run-is-fenced-to-its-channel-by-a-narrowing-header.md) (fenced runs).

## Problem

Every agent ran in a runner on someone's Mac. Shut the laptop and `@scout` stopped answering. People without Claude Code had no agent at all.

Example: Simon makes `scout` in the New agent dialog with machine "Cloud", shuts the laptop, and Rosa writes `@scout what is left on #806?` from her phone. Scout answers in the thread within seconds; later `@scout and the one after?` is answered with the first conversation in mind.

## Scope

- **The machine `cloud`** is a hosted machine (`machines.hosted`, migration `0031_cloud_machine.sql`) offering the built-in harness `pi-durable`. The Worker's minute cron upserts its row and heartbeat, but only on a board with a model proxy (`FLOCKR_MODEL_BASE_URL`), so a board that cannot run agents never offers it. A hosted machine counts as online while its heartbeat is under 3 minutes old (`machineLimits.hostedOnlineSeconds`); a runner cannot register or beat for it. Its agents need no folder and use board tools only. `Machine` gains `hosted`; `CreateAgentBody.folder` becomes optional and is refused only on a machine that is not hosted.
- **One Durable Object per cloud agent** (`CloudAgent`, keyed by the agent's name, `apps/server/src/platform/cloudflare/cloud-agent.ts`). It hosts Pi Durable on the object's SQLite (`@earendil-works/pi-durable/storage/sqlite/cloudflare`), wired to the object's alarm with `onWake` exactly as the Pi Durable README shows, and runs the runner's own service and wake rules for that one agent (`apps/runner/src/cloud/agent.ts`). Nothing in the object decides board rules.
- **Board calls stay in the Worker.** The object calls the same Hono app in-process through a fetch function, signed in as the agent with an agent token (`fag_`, HMAC from the sign-in secret, 15 minutes, re-minted per call). So `canSee`, keys' channel limits, the run fence and other-org rules apply exactly as for any agent.
- **Models through the proxy.** The object's model provider points at `/api/model` with a box token for `agent:<name>`, in-process too; the model key exists only in the Worker's secrets. Without `FLOCKR_MODEL_BASE_URL` the machine stays offline; an agent made before that reports an error and posts nothing.
- **Wake.** After any `/api` write that produced live events, the Worker pokes every serving cloud agent's object (`waitUntil`, after the response; an object's own writes skip itself). A poked object reads `listEvents?since=<cursor>` as itself and hands each event to its runner; `EventPage.through` (new) is the last sequence number the page read, shown or not, so a run of events the agent may not see never stalls its cursor. The runner applies the Mac runner's rules unchanged: a mention starts a conversation, a ready task assigned to it is claimed and worked, reviews and verdicts, other orgs' messages wake nothing, task state does. The minute cron pokes them too, so a lost poke costs at most a minute. Pi's own sleeps and retries come back through the alarm.
- **Steer.** A reply in a thread the agent is running in goes into the running session; the Pi adapter now submits it with `whenBusy: "steer"`, so it joins the running work after the current tool round instead of waiting for the run to end. The same change applies to Pi agents on a Mac.
- **Memory.** The Pi conversation per thread lives in the object's SQLite; each turn's changed rows are saved as one PL5 chunk (`pi-rows/1`) through `saveSessionChunk`. A wiped object (or one moved to another account) has no Pi tables, opens the session (fencing out any old copy) and rebuilds from its chunks before it starts. Channel memory and notes come from the board as on a Mac.
- **The fence.** Every board call a Pi session makes is sent with `x-flockr-channels: <the run's channel>`. The Pi adapter keeps the run's channel in its thread document, so a turn resumed after a crash is fenced too. This closes the same gap for Pi agents on a Mac.
- **Portable runner core.** `createRunner`, `createService`, the Pi adapter and its chunk code no longer import Bun or the runner's file config, so the Worker bundles them: limits moved to `apps/runner/src/limits.ts`, the chunk diff runs on any `SqliteDatabase` (gzip through `CompressionStream`), and the Pi state store is an interface (`PiStore`: a SQLite file on a Mac, the object's database in the cloud).

**Out:** coding tools and sandboxes (PL6 later added `read`, `write`, `edit` and `bash` in a box per task, ADR 0037; pull requests are 4d); model providers other than the proxy (an agent picks a model id with its `model` field); adding an agent to a channel needs nothing new (11a's channel members); a Bun host for cloud agents (on `bun dev` and self-host the machine `cloud` stays offline, so the dialog does not offer it; Notes); the spend cap (PL12).

## Schema

- `machines.hosted boolean not null default false`. The row `cloud` (`hosted`, harness `pi-durable`, label "Built-in agent") is upserted by the cron, not the migration, so `seed --reset` cannot lose it for more than a minute (`cloudMachine` in `apps/server/src/cloud/host.ts`).
- Durable Object class `CloudAgent` with migration tag `v2` in `wrangler.jsonc` (both environments). Its SQLite holds Pi's tables and one `flockr_state` table: the event cursor, the restore marker, the chunk ledger and the runner's session list.

## Routes and surfaces

- No new operation: a cloud agent is made with `createAgent` and `machine: "cloud"`; `listMachines` shows `hosted` and `listEvents` returns `through`. `bun run generate` carried both to the client and MCP.
- `flockr agents create scout --cloud` (same as `--machine cloud`; no `--folder` needed); `flockr machines` marks hosted machines.
- Web app: the New agent dialog offers "Cloud" whenever the machine is online, and hides the folder field for it.
- The agent token is not an operation: only the board mints it, for its own objects.

## Rules the tests hold

`apps/server/test/cloud-agents.test.ts`, against the real app and Postgres with a scripted fake model:

- Nothing runs without a mention, a task or a schedule: a poke with unrelated posts makes no model call and no run.
- A mention is answered once, as the agent, through the model proxy with a box token.
- Steering joins the running turn: a reply sent while the model is thinking reaches the same run, and both are answered in one conversation.
- A crash mid-turn resumes without repeating a write: an object dropped after its reply was posted and restarted posts nothing twice.
- A wiped object restores from its chunks and remembers the earlier turn.
- The fence holds: every board call a cloud session makes carries its run's channel. Another org's agent mentioning ours wakes nothing.
- A ready task assigned to the agent is claimed and submitted for review.
- A forged, foreign-secret or expired agent token, or one naming a person, is refused.

`apps/runner/test/pi-durable.test.ts`: every board call of a Pi session carries its run's channel. `apps/runner/test/cloud.test.ts`: nothing the cloud entry loads imports Bun, the runner's file config, a child process or the Node execution env.

## Exit checklist

- [x] Spec, ADR 0036, migration, `bun run generate`.
- [x] `CloudAgent` object, Worker poke and cron, wrangler bindings; the Worker bundles (`wrangler deploy --dry-run`, 1.0 MB gzip, no Bun or child process imports).
- [x] Runner core portable (`apps/runner/test/cloud.test.ts`); Pi steer and fence; `PiStore`.
- [x] CLI `--cloud`, dialog option, docs (runner README, architecture guide). The board skill is unchanged: agents see nothing new.
- [x] Rule tests pass; `bun run check` passes.
- [ ] Seen end to end on the deployed board (Steps for Simon); not run here: no deploys and no paid model calls.

## Steps for Simon

- [ ] Set `FLOCKR_MODEL_BASE_URL` and `FLOCKR_MODEL_KEY` (OpenRouter) as Worker secrets, with a spending cap on that key, and `FLOCKR_CLOUD_MODEL` (the default model id, such as an OpenRouter id) as a var; an agent's own `model` wins. Until the base URL is set the machine `cloud` stays offline.
- [ ] Deploy (`wrangler deploy --env production`): it adds the `CloudAgent` class (migration `v2`) and runs migration `0031`.
- [ ] Make a cloud agent from the New agent dialog, mention it, shut the laptop, mention it from the phone.

## Notes from the build
- **The model proxy never cancelled upstream.** It forwarded the model call without the caller's abort signal, so a stopped or crashed run kept a paid request streaming to the end. It now passes `request.signal` on (found when the crash test hung on a model call that ignored the abort).
- **A resumed Pi turn had no model.** The model provider was registered lazily on the next new turn, so a turn recovered after a crash failed with `no_model`, on a Mac as much as in the cloud. The Pi adapter now registers the default and the agent's own model ids before it resumes anything.
- **A file snapshot must not take the write lock.** The chunk diff first ran inside the facade's `BEGIN IMMEDIATE` on a second connection to the agent's file, which waited up to 5 seconds whenever Pi was writing. The file store reads its snapshot with a plain `BEGIN`; the object's single database uses its own transaction.
- **A crash is not a close.** Closing Pi's storage under a running turn is a crash to Pi (`storage_failed`, the attempt counted), and with retries off the turn ends `interrupted`. Production keeps `retry.maxRetries: 2`, and the crash test runs with retries on and a short backoff.
- **No Bun host for `cloud` yet.** On `bun dev` and self-host nothing beats the machine `cloud`, so it stays offline and the dialog does not offer it. Hosting cloud agents in the Bun server is `hostCloudAgent` with a SQLite file per agent and a poke from the Postgres listener; left out to keep this change to the Worker.
- **The poke is wide on purpose.** Every serving cloud agent is poked after every write and reads its events; the runner's rules decide. Narrow it with a prefilter only once there are enough cloud agents for the wakes to show in the bill (ADR 0036, Costs).
- **The live client uses event listeners.** `connectLive` switched from `onopen`/`onmessage` to `addEventListener`, because the Worker bundle now typechecks the client against the Workers WebSocket type, which has no `on*` properties.
- **Run once in local workerd.** `wrangler dev --test-scheduled` against a local database and a fake model server: the cron brought `cloud` online, `createAgent` on it worked, and a mention was answered in the thread through the proxy (the fake upstream saw only the board's key). Without `FLOCKR_S3_*` the local Worker refuses chunk saves (ADR 0032), so saving and restoring were proven by the Bun tests only. Two bugs only the bundle showed:
  - Importing `createModels` through `@earendil-works/pi-ai`'s package index lost esbuild's lazy module init (`ModelsImpl is not a constructor`). Worker code imports it from `@earendil-works/pi-ai/models`.
  - The first start set its cursor to the head after the object finished opening, so a mention made while it opened was skipped. It now takes the head before anything else.
- **A board without a bucket refuses every save** (`wrong_state`); the cloud saver re-opened the session for each one, bumping its epoch every turn. It now keeps its fence after the first open and logs the refusal once per turn.
