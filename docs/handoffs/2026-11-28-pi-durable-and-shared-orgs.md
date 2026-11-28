# Handoff: Pi Durable stays, and orgs sharing one board, 28 Nov 2026

## Where it stands

- A research and design session, no sub-phase built. Slug: `research-pi-durable-shared-orgs`.
- Saved in this change: `docs/reference/RESEARCH_CLOUD_AGENTS.html` (ComputeSDK, more sandbox providers, section 9 Agent frameworks), `docs/reference/AGENT_FRAMEWORKS_GRID.html` (feature grid of Pi Durable, Eve, TanStack AI, Mastra, AI SDK and Claude Code, with similarity scores), `docs/reference/C4_SHARED_ORGS.html` (proposed Phase 11 container diagram), and the `Blocked:` statuses below in `docs/phases/SPEC_MASTER_CHECKLIST.md`.
- Not in this change: the edits to `docs/phases/SPEC_COMPETITOR_PARITY.md` were already uncommitted before this session (Zed Delta, Hugging Face Swarms rows); they belong to whoever wrote them.

## Done

- Decided with Simon: Pi Durable stays Flockr's built-in harness. TanStack AI, the Vercel AI SDK, Eve and Mastra were weighed (section 9 and the grid). TanStack's harness has the same crash rules on paper, but you write its store and its coding tools are Node only; Cloudflare's own Agents docs recommend the Pi harness for new agents.
- A spike outside this repo proved Pi Durable behind AG-UI: text deltas, tool calls, live tool output, state patches, an approval as an interrupt that survives a crash, no double send after a kill mid-call, reconnect without duplicates (`~/workspace/dev/playground/pi-durable-agui`, local commit only).
- Phase 11 direction from Simon: people and agents are one kind of member, as in Buzz; members belong to an org; a client org's people and agents join shared channels; ideas to borrow from Vercel Board, Zed Delta and Hugging Face msgboard (P11, P95 to P101 in the parity file). Drawn in `C4_SHARED_ORGS.html`.

## Left, in order

1. Phase 11 spec once Simon answers the three questions on row 11a: write the Phase 11 README and spec (`SPEC_PHASE_11_ORGS_SHARED_CHANNELS.md`) in a new `phase-11` folder under `docs/phases`, then rework rows 11a and 11b. Proposed sub-phases: orgs and `canSee` on every surface (routes, live socket, MCP, CLI, search, Focus, tasks, catch-up), invites for people (email) and agents (channel-scoped keys), channel-fenced agent runs, then shared threads with their branch and live changes, a request key per post (P100), a living document per channel (P99), typed blocks (P11), wait with a timeout (P5), read cursors across orgs (P101), signed events later.
2. An ADR replacing 0019 once Simon says yes: Pi Durable with tools in a fast-sleeping box is the default coding agent; Claude Code and `pi-coding-agent` are per-agent harness choices. Start in `docs/decisions/`.
3. 4c Cloud agents: one Durable Object per agent running Pi Durable on its SQLite store, saving through PL5's session chunks. Start in `apps/server/src/platform/cloudflare/`.
4. PL6 cloud sandbox adapter in `packages/sandbox/`, then Pi Durable coding tools in `apps/runner/src/harness/pi/tools.ts`: `bash` and search in the box, a default timeout on every command, carry on when a turn hits the output limit (the two gaps the harness benchmarks showed).
5. 5d Slack sync through the Chat SDK inside a bridge adapter, once there is a Slack app.

## Decisions made

- Pi Durable over TanStack AI and the AI SDK for agents on Cloudflare (Simon, 27 Nov). Not yet an ADR: it confirms ADR 0008, so it goes in the ADR in step 2.
- Durable Streams not adopted: the event log with catch-up from `since=N` already does the job; revisit only for a live run view (`fc watch`) or an outside feed.
- ComputeSDK not a dependency: its hosted router sits in front of every box and its release pace breaks the 14-day rule.

## Watch out for

- The spike pins Pi Durable 1.5.1, like the runner; npm has 1.7.0. Upgrade on purpose and rerun crash tests.
- Pi Durable's `watch()` can lag the stored state; the spike used `observeConversation`. Its hooks can read but not write state.
- The Herdr skill was missing from codemode; it is now saved there as `herdr`. Start task sessions with `herdr-app do tab.new` in the project space, not `hc run`.

## Waiting on

- Simon: the three Phase 11 answers (row 11a).
- Simon: yes or no on replacing ADR 0019 (row 4d).
- Simon: an OpenRouter spending cap for 4c (row 4c).
- Simon: Blaxel or Cloudflare Containers for the cloud sandbox, and the GitHub App (row 4d).
- Simon: a Slack app (row 5d).

## First command next session

`sed -n '/^## Phase 11/,/^## Phase 12/p' docs/phases/SPEC_MASTER_CHECKLIST.md`
