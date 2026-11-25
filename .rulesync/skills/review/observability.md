# Observability review checklist

An observability review asks one question of every place code runs: if it failed now, would we know, and how fast? A failure nobody hears about is worse than a loud one, because it stays broken while people think it works. Every finding is proven locally by forcing the failure and checking what appears; a gap you could not force is PLAUSIBLE.

The example that shows why: in maestro-service a background job read its payload through a strict schema that rejected a field the plumbing added, threw before its first step, and the runtime swallowed the throw. Logs had zero lines, nothing alerted, and a feature was silently broken for a day. In Flockr the same shape would be the lease sweeper throwing on one bad row and stopping, so no lease ever expires again and every crashed agent holds its task forever.

## Method

1. **Map every place code runs.** List each with the file that receives it. Missing one is the worst finding, since everything below is checked per entry point. Start from:
   - API requests (`apps/server/src/app.ts`), with `flockr` and the web app as clients of them
   - the MCP server (`apps/server/src/mcp/`), which runs routes in-process
   - the live socket and the `LISTEN/NOTIFY` listener (`apps/server/src/live/`)
   - the lease sweeper timer (`apps/server/src/live/sweeper.ts`)
   - background jobs once they exist (pg-boss watchers, routines, sync)
   - the web app in the browser (a render error, a failed call, a dropped socket)
   - `flockr` (a failed call, a lost `flockr tail` connection)
   - the Mac helper and cloud runners once they exist (Phase 4)
   - migrations and the server start
2. **For each, answer three questions and prove them.** Where is the failure stored (server output, an event, a table)? What tells a person (a message in a channel, an alert, nothing)? How fast does someone know (seconds, the next morning, never)? Then force a failure locally (a thrown error, a payload the schema rejects, Postgres stopped mid-run) and check what appears. Record the command and what appeared.
3. **Hunt the silent failures** in the checklist below, by grep and by reading.
4. **Read the failure records** each forced failure wrote: they carry what debugging needs and nothing secret.

Write the findings to `docs/reviews/REVIEW_OBSERVABILITY_<SCOPE>_<YYYY-MM-DD>.md` in the skill's step 4 shape, plus one table before the findings: entry point, where stored, what tells a person, time to know, forced and seen (yes or no).

## Checklist

Each line is a check, then why it matters.

- **Every entry point reports at its outermost edge.** A throw anywhere in it reaches one reporting place (`app.onError` for requests), not only throws inside a handler. Why: a throw outside the handled part is the one nobody sees.
- **A loop survives one bad item.** The sweeper, a job or a listener that handles many rows reports the one that failed and carries on with the rest, and keeps running on its timer. Why: one bad lease must not stop every lease from expiring.
- **A runtime that swallows throws is wrapped.** A timer callback, a socket handler, a `NOTIFY` listener and any work started without `await` each have their own catch that logs and reports. Why: those runtimes drop the error with no caller to see it.
- **A strict schema survives the fields we add.** A `z.strictObject` on a payload we build ourselves either lists every field the plumbing adds or the plumbing strips them first. Why: the maestro-service failure above.
- **A schema rejection says where.** A failed parse logs the Zod issue paths, never only "invalid input". Why: a rejection with no path means reading every caller.
- **No catch swallows.** A `catch` that returns `null`, `[]`, `false` or a default, or logs only, also reports when the failure is ours to fix. Grep `catch` and `.catch(` in scope. Why: a quiet fallback turns a broken feature into an empty one, which looks like no data.
- **A surface that goes quiet is noticed.** The sweeper, the live socket and later the routines have a heartbeat: no sweep in its expected window, or a socket that stops getting events while writes land, is reported. Why: a stopped timer raises no error.
- **Agents that go quiet are visible.** A claimed task whose holder stopped renewing shows as running low, then ready again, on every surface, and the thread says why. Why: on a board, a silent agent is the failure people meet most.
- **The browser reports too.** A web app render error or a failed call it cannot recover from is reported to the server, not only shown in the console. Why: a broken screen on one phone is invisible to everyone else.
- **`flockr` fails loudly.** A failed call exits non-zero with the failure's `kind` and message in `--json` output, and `flockr tail` says when it reconnects. Why: an agent reading a zero exit thinks it worked.
- **Failure records carry the ids.** A logged failure names the entry point, the route or job, the request id, the board, the task and the member. Why: "claim failed" with no task id cannot be found again.
- **Failure records carry no secrets or message bodies.** Paths and field names, never the rejected value; no key, token or message text (the security checklist, Logs and errors). Why: a Zod error prints the value it rejected by default.
- **A failure reaches a person.** Once Flockr runs beyond the Mac, a failure that matters posts to a channel people read (the board itself is a good place), and a new kind is not hidden behind an old one. Why: a stored failure nobody is told about is a number nobody reads.

## Learned from reviews

Each line is a class of mistake an earlier review caught, added by that review's run (step 5 of the skill), with the review file it came from. Check every line here as well as the checks above.
