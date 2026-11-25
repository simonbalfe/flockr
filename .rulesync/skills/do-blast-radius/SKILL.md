---
name: do-blast-radius
description: Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it is safe because of by running real code. Use when Simon says "blast radius of X", "what could this break", or before shipping a change you don't fully trust.
targets: ["*"]
---

# Blast radius

Adapted from pstack's `blast-radius` skill (MIT, Lauren Tan; see `LICENSE`).

Listing the callers is not the job; grep does that in a second. The job is the breakage grep won't show. A writeup that sounds right is worthless, because it reads as convincing whether or not it is true. Find the one or two facts the change's safety depends on and prove them by running code.

## How sure are you

Push each fact as far down this list as is cheap, and say where it stopped.

1. You said so. Worthless on its own.
2. You pointed at the line: a real `file:line`, or the library's own source.
3. You walked the failure step by step and showed it can't happen.
4. You ran it: a script or test that calls the real code and fails loudly if you are wrong.
5. You reproduced it in the running app (the `do-verify` skill, only when Simon asks).

## Steps

1. **Read the change:** the diff, the symbols it adds, changes and deletes, and what it now does differently that the diff doesn't spell out.
2. **Find the one fact it is safe because of.** Most risky-looking changes are safe because of one fact. Example: moving lease expiry from a request-time check to the sweeper is safe for a holder finishing late because a complete passes only the holder check in `apps/server/src/board/`, which refuses a member who no longer holds the task or who sends an old claim epoch, so a late complete after a re-claim changes nothing. If that holds, most risks clear at once.
3. **Look where grep stops:** a library's real source at its pinned version, the JSON a route returns, a database column or `CHECK`, the events a write emits and who reads them, the generated client, the MCP tools and `flockr` commands that wrap a route, the web app's cache patching, the live socket's "after N", the sweeper running on several instances.
4. **Be honest about each risk:** a real chance and a real cost. Keep the confirmed risks; list the checked and cleared ones separately. Cite a real `file:line`, and never make up a caller or an API.
5. **Prove the one fact:** write a small script or test that runs the real code (against the local Postgres), run it, and paste the result.

## Reply

- **What it does,** including the part that isn't obvious.
- **The one fact it is safe because of:** stated, the level it reached, and the proof, or marked unproven.
- **Risks:** how each breaks, `file:line`, how likely and how bad, how to check.
- **Cleared:** what you checked and why it is fine.
- **Before shipping:** the cheapest test or repro that would catch the real bug.
