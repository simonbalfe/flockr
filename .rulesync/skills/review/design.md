# Design review checklist

A design review finds what is hard to change. It does not look for bugs: it takes the changes most likely to come next, traces each through the code, and reports where one change has to land in many places. Read only; it changes nothing but its review file.

## Method

1. **List the next changes.** Read the Not started rows of `docs/phases/SPEC_MASTER_CHECKLIST.md` and the Unplaced parity rows, and pick the 10 to 15 most likely next, plus the obvious growth cases: another harness, another sandbox provider, another sync (Slack, GitHub, Linear), a new task state, a new member kind, a second board, agent keys, sign-in. One line each: the change, in the words of its row.
2. **Trace each one** through the code it would touch: the tables, board functions, routes, the MCP server, contracts lists, `flockr` commands and web app screens. Write down every file and folder it lands in, and any stored data it moves.
3. **Rate each change** easy, medium or hard by where it lands. A change that touches more than one feature folder, or names a provider outside its own adapter, is a finding.
4. **Write each finding** with the smallest fix, its cost (files and roughly how long; any data migration and how many rows), and a blast-radius note from the `do-blast-radius` skill (what else the fix could break, and the one fact it is safe because of).
5. **Split by area** so several reviewers can run at once: one review file per area (`DATA`, `API`, `LIVE`, `WEB`, `CLI`, `ADAPTERS`), `docs/reviews/REVIEW_DESIGN_<AREA>_<YYYY-MM-DD>.md`: a verdict, a change-cases table (case, files touched, data migration, rating), then the findings table.

## What makes a change hard

- **One more branch per new member.** Adding a task state, member kind, harness or sandbox grows an `if` or `switch` in several files, or a second flag that must stay in sync with the first, instead of one entry in a list, map or registry (pstack `principle-model-the-domain`)
- **Pass-through layers and hidden state.** A wrapper with one caller, an adapter with no second implementation, or state set in one place and read far away; a new reader cannot answer "where does X come from?" and "what can change X?" in 30 seconds (pstack `principle-minimize-reader-load`)
- **Data shaped against its access paths.** A table or type that the main reads have to reshape, join around or filter in code; a column per provider where the reads want one row per provider (pstack `principle-foundational-thinking`)
- **Provider detail past the edge.** A harness's, sandbox's or outside service's names, ids or response shapes outside its adapter: in a board rule, an event, a shared table or a screen (pstack `principle-boundary-discipline`, ADR 0009)
- **Two ways to do one thing.** An old path kept beside its replacement (the web app's fake in-memory store beside the real client, two readers of one fact), so each change picks one and the other drifts (pstack `principle-migrate-callers-then-delete-legacy-apis`)
- **One fact in two homes.** The same value stored in two tables or columns that can disagree (a task's holder kept on the task and again on a separate claims row; the event log is the one allowed copy, since tables are kept in step with it in the same write), so a write to one never shows in the other (the backend checklist, One definition per concept)
- **A typical change lands in one place.** A routine feature (a new task action) that needs edits in more than one feature folder, or a list that has to be updated by hand in several files
- **A surface built by hand.** A capability added to the web app or `flockr` without a route, or an MCP tool written by hand, so the surfaces drift (ADRs 0003, 0010)
- **A board or member in code.** A board, channel, member or agent name in a constant or env var (`boardId` in `apps/server/src/config.ts`), so a second board needs a code change instead of rows
- **Stored data in the way.** A fix that needs a rename, merge or drop of a table with rows costs a migration and a backfill; say so in its cost, and say whether the append-only event log is involved

## Learned from reviews

Each line is a class of mistake an earlier review caught, added by that review's run (step 5 of the skill), with the review file it came from. Check every line here as well as the checks above.

- A provider's state kept as its own columns on a shared table instead of rows keyed by provider (carried over from maestro-service's design review)
- A core query or report that names one provider, so a second one needs a branch in every method (carried over from maestro-service's design review)
