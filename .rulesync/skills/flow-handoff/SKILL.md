---
name: flow-handoff
description: Write a handoff at the end of a session with work in flight, so the next session resumes without the conversation. Use when Simon says "handoff", "write a handoff", or ends a session with work left mid-flight.
targets: ["*"]
---

# Handoff

Write `docs/handoffs/<YYYY-MM-DD>-<slug>.md` (as `docs/handoffs/2026-11-23-plan.md` is named). The newest file in `docs/handoffs/` is where the next session starts. Derive everything from the repo (the spec, the code, `git status` and `git log` once Flockr is a git repository), not from memory of the conversation.

## Steps

1. Read the current sub-phase's spec, its row in the master checklist, and what changed in the working tree.
2. Write the handoff with these sections, each a few bullets:
   - **Where it stands:** the sub-phase and slug, what is saved, and whether it is committed.
   - **Done:** the spec's exit checklist items finished.
   - **Left:** the unfinished items, in the order to do them, each with the file to start in.
   - **Decisions made:** small choices taken mid-build and why; link any ADR written.
   - **Watch out for:** anything that broke, surprised you or is half-done.
   - **Waiting on:** what Simon or an outside party must do, one line each.
   - **First command next session:** the exact command to run first.
3. Make each item that waits on a person the `Blocked: <what is needed>` status of the checklist row it blocks.

**Closing one:** whoever finishes the work, or finds that what is left waits only on a person, deletes the handoff in the same change, after moving each wait onto the row it blocks.

No secrets, keys or real people's messages in a handoff.
