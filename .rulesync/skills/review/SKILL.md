---
name: review
description: Independent reviews of Flockr (backend, typescript, security, frontend, docs, ux, design, observability), one fresh session per kind, each proving its findings by reproducing them and writing a review file in docs/reviews/. Use only when Simon types /review or asks for one in his own words, such as "review the backend", "review the TypeScript", "security review", "review the docs", "UX review", "is this flow clear", "design review", "what is hard to change" or "would we know if this broke". Optional and slow; never on your own, never as a step or a gate.
targets: ["*"]
---

# Flockr reviewers

Eight kinds of review, run on demand. They are not gates: no sub-phase waits on one, and no agent starts one unasked.

Usage: `/review <kind> <scope>`, or a plain request: "review the backend" runs `backend` (with `typescript`), "review the TypeScript" runs `typescript`, "is this flow clear to a new user" runs `ux`, "what is hard to change" runs `design`, "would we know if this broke" runs `observability`. A UX review takes a flow as its scope: `/review ux tasks` walks the tasks view as a newcomer.

| Arg | Values |
|---|---|
| `kind` | `backend`, `typescript`, `security`, `frontend`, `docs`, `ux`, `design`, `observability`, or `all` |
| `scope` | A phase (`1`), a sub-phase (`1c`), a spec file, or a folder. For `ux`, a flow (`channels`, `thread`, `tasks`, `waiting`, `mentions`, `phone`) or a sub-phase id. For `design`, an area (`data`, `api`, `live`, `web`, `cli`, `adapters`); several areas run as several reviewers at once. For `observability`, an area (`api`, `live`, `sweeper`, `mcp`, `web`, `jobs`) or `all`. With none, `docs` reviews every doc; the other kinds ask once |

| Kind | Reads | Checklist |
|---|---|---|
| `backend` | `apps/server`, `packages/contracts`, the CLI; always with `typescript` | [backend.md](backend.md) and [typescript.md](typescript.md) |
| `typescript` | Every `.ts` and `.tsx` file in scope. Runs inside every `backend` review, or on its own | [typescript.md](typescript.md) |
| `security` | Identity and keys, claims and fences, untrusted agent text, secrets, the live socket, MCP, dependencies | [security.md](security.md) |
| `frontend` | `apps/web`, in a real browser | [frontend.md](frontend.md) |
| `docs` | Everything written for people or agents: `overview.md`, every skill, every doc under `docs/`, the READMEs, the board skill in `skills/flockr/`, and the API document, `flockr` help and MCP tool text, all against the code | [docs.md](docs.md) |
| `ux` | One flow walked as a newcomer in a real browser: user stories, paths and clicks, friction, confusion, clarity per step | [ux.md](ux.md) |
| `design` | What is hard to change in one area: the next 10 to 15 likely changes from the master checklist, each traced through the code | [design.md](design.md) |
| `observability` | Every place code runs (requests, MCP, the live socket, the lease sweeper, jobs, the web app): where a failure is stored, what tells someone, how fast, proven by forcing a failure locally | [observability.md](observability.md) |

**The cycle:** each checklist says what to audit, which is never done (debt, security, UX, code quality); each run writes what to fix this time in `docs/reviews/`; fixes work those rows. A phase holds only work that can be Done.

Why reviews work this way: an author reads their own code as they meant it. A fresh reader who must reproduce each finding reports real defects and drops the guesses. Each run then adds a checklist line for every new class of mistake it caught (step 5), so the reviews improve with use.

## 1. Say the cost, then start

Reply with one line before any work: which reviews run, roughly how many files, and whether the local stack is needed. Then carry on; Simon asked by invoking the skill.

| Kind | Needs the local stack |
|---|---|
| `backend`, `typescript` | Only Postgres (`docker compose up -d db`), to reproduce with `bun test` or a throwaway script |
| `design` | No. It reads code and traces changes; nothing runs |
| `docs` | Only to run an example against the API, `flockr` or MCP |
| `security` | Yes, for the cast in [security.md](security.md) |
| `frontend`, `ux` | Yes |
| `observability` | Yes, to force each failure and see what appears |

When the stack is needed, start it as the `do-verify` skill says. Never point a review at a deployed board or real people's messages.

## 2. Scope

- **Specs:** the `docs/phases/phase-N/SPEC_PHASE_*.md` files in scope, with their exit checklists and Notes from the build.
- **Code:** the files the spec names, or the folder given. Once Flockr is a git repository, `git diff <base>...HEAD --stat` for a range.
- **Rules:** `CLAUDE.md` (Always and Code conventions) and the ADRs the spec links.
- **Earlier reviews:** `docs/reviews/REVIEW_*`, for deferred items whose trigger is now met.

## 3. Independent reviewers, one per kind

Launch one fresh Claude session per kind, each in its own Herdr tab in your project space, never in the context that wrote the code:

```
herdr-app do tab.new --space "$(herdr-app ls | jq -r --arg t "$HC_TERMINAL_ID" '.spaces[] | select(any(.tabs[].terminals[]; .terminal==$t)) | .id')" --name review-<kind> --folder "$PWD" --argv '["claude","-n","review-<kind>"]' --focus false --task "<brief>"
```

While Flockr has no git repository, reviewers run in the main folder and write only their own files. Once it has one, each gets a detached worktree at the latest `main` (`git worktree add --detach .claude/worktrees/review-<kind> origin/main`, then `bunx rulesync@26.0.0 generate` in it) and `--folder` points there. When a reviewer reports, close its tab (`herdr-app do tab.close --id <tab>`). For `all`, launch the six together (`typescript` runs inside `backend`; `design` runs only when named). Brief each one:

- The kind, the scope, the spec paths and the checklist file to read in full.
- "Do not modify repo files, except your review file, its row in `docs/reviews/README.md` and the Learned from reviews section of your checklist file. Read every file in scope in full."
- "Write your report to `docs/reviews/REVIEW_<KIND>_<SCOPE>_<YYYY-MM-DD>.md` in the shape in step 4, with every Outcome `open`, and add its row at the top of the table in `docs/reviews/README.md` (file, kind, date, open count, state; create the folder and index with the first review). Then learn from it as step 5 says. Never write the report to a scratchpad or `/tmp`: a reboot deletes it and nobody records it."
- "Verify each suspected defect: read the surrounding code and the library source, then reproduce it with `bun test <file>` or a throwaway script in the scratchpad. Label anything you could not reproduce PLAUSIBLE."
- "Local only. No deployed board, no outside service, no real person's data. Use invented names."
- "Report per finding: severity (high, medium, low), `file:line`, the defect, the concrete failure (input or state, then the wrong result), how you verified it, and a fix. Then a spec section: each exit item done, partial or missing."

## 4. Verify, fix, record

1. **Re-verify** each finding yourself with a quick reproduction. Reject what does not reproduce, and say so.
2. **Fix** what is clearly right. Add a test only when the finding is a rule the tests cover (claims, leases and fences, needs, event order, repeat-safety, access, a public contract). Ask before anything destructive or on the Stop and ask list.
3. **Record the rest:** deferred with the trigger that brings it back, or accepted with the reason.
4. `ux` only: re-walk every story at every viewport after the fixes, as [ux.md](ux.md) says.
5. `bun run check` green, then ship the fixes by the Workflow steps in `CLAUDE.md`.
6. **Record** in the reviewer's file: set each Outcome (fixed, deferred, rejected) in the same change as the fix, and update its Open count and state in `docs/reviews/README.md`. Reviews are otherwise append-only; a second run the same day ends in `-2`. A `ux` review uses the shape in [ux.md](ux.md) instead.

```markdown
# Review: <kind> · <scope> · <date>

- **Scope:** <files or range>
- **Method:** independent reviewer; findings reproduced; author re-verified
- **Verdict:** pass | pass with deferrals | fail

## Findings
| # | Severity | Where | Finding (verified) | Outcome |
|---|---|---|---|---|

## Spec coverage
## Inputs for the next sub-phase
```

7. **Codify:** a finding rejected in step 4.1 loses the checklist line step 5 added for it, in the same change as its Outcome. Where a lint rule could catch a class of mistake for free, tell Simon and add it to `docs/guides/GUIDE_CODE_STANDARDS.md` instead of building the rule.

## 5. Learn: one checklist line per new class of finding

Every run, right after writing its review file, teaches its own checklist, so the next run looks for what this one found. The reviewer does it, in the same change as the review file.

1. **Name the class** of each finding: the rule it broke, as a check a reviewer can run anywhere, not the one file. Finding: "the tasks list sorts by `created_at` alone, so two tasks made in the same second swap between pages". Class: "lists page with a stable order and a unique tiebreaker".
2. **Look for it** in the whole checklist file, the checks and the Learned from reviews section, by its key words. Already covered: add nothing. Partly covered: sharpen that line in place and add this review file to its sources. A one-off finding (a typo, one stale value) has no class: add nothing.
3. **Add one line** per new class at the end of the Learned from reviews section of that kind's checklist file (a `backend` run puts a type finding in `typescript.md`), in this shape:

   ```markdown
   - A renew that arrives after the lease ran out is refused, never silently re-claimed (`docs/reviews/REVIEW_BACKEND_1C_2026-12-01.md` #3)
   ```

   One line per class, however many findings share it.
4. **Run `bunx rulesync@26.0.0 generate`** so the generated copy of the skill matches, and say in the review file's last section how many lines were added or sharpened.

Edit the checklist only in `.rulesync/skills/review/`, never the generated copy. Never remove or reword a line another review added, except to sharpen it as step 2 says, or when step 4.7 removes it.
