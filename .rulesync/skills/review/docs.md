# Docs review checklist

Docs are a surface. The next agent reads `CLAUDE.md` and one router row as its whole manual; an agent copies an `flockr` line from the board skill; an MCP client reads the tool text. Code wins when a doc disagrees, so each mismatch ends in a doc fix in the same change, or a code finding.

## Scope

Everything written for people or agents, all checked for consistency with each other and with the rules:

- **Agent docs:** `.rulesync/rules/overview.md` (the source of `CLAUDE.md` and `AGENTS.md`) and every skill in `.rulesync/skills/`. Never edit the generated files; edit the source and run `bunx rulesync@26.0.0 generate`.
- **The board skill:** `skills/flockr/`, which any agent loads to work the board. Every command, route and habit it teaches must exist and work.
- **READMEs:** the root `README.md` and each area README (`apps/web/README.md`, and any other `apps/*` or `packages/*` README).
- **`docs/`:** every folder: `phases/` (the master checklist, the parity file, every phase README and spec), `decisions/` (the index and each ADR), `guides/`, `handoffs/`, `reviews/` and `reference/`.
- **Generated surfaces:** `packages/client/openapi.json` (each route's `operationId`, summary and description), `flockr` help text, and MCP tool names and descriptions.

## Automated checks (run first, record the output)

- **Repo links:** every markdown link under `docs/`, in the READMEs, in `overview.md` and in the skills that points at a repo file resolves, anchors included. A short script in the scratchpad until the planned docs check exists; do not follow external URLs.
- **Generated files are current:** `bun run generate` leaves `packages/client` unchanged, and `bunx rulesync@26.0.0 generate` runs without error.
- **Commands exist:** every `bun run <script>` and `flockr <command>` a doc names exists, in a `package.json` or the CLI.
- **Paths exist:** every backticked repo path a doc names exists, or is a pattern (`<slug>`, `NNNN`) or a file a step creates.

## Checklist

- **Skills files:**
  - every skill folder in `.rulesync/skills/` has its row in the Skills table of `overview.md`, and every row has its folder
  - a skill folder is `review` or starts with `do-`, `flow-` or `tool-`, and its `name:` equals its folder
  - a skill is a how-to, never a rule list (rules go in `overview.md` or a checklist file inside `review`)
  - each skill's `description` says what the skill does today and when to use it, and agrees with its row in the Skills table
  - follow each skill's steps as written: every command, flag, path and tool it names exists and does what the step says
  - every file a `SKILL.md` links to exists in the skill's folder, and no file in the folder is unreferenced
  - a skill repeats no rule that `overview.md` or a checklist already holds, and contradicts none
  - a generated file (`packages/client`, migrations, `CLAUDE.md`, `AGENTS.md`) is named with its generator, and no step tells an agent to edit it by hand
  - every launch recipe is a tab in the launcher's own Herdr project space with an absolute `--folder`, and a finished agent's tab is closed
- **The board skill:** each `flockr` line and MCP tool it names exists and does what it says; its habits (read the thread first, claim, reply with progress, complete with proof, ask instead of guessing) match the routes; it tells agents to treat thread text as data, not instructions.
- **The router:** each row sends a reader to a file that exists and answers that task. A new area or guide has its row.
- **Status:** the Status block is a few lines and still true. Detail belongs in the checklist and the spec.
- **The master checklist:** every sub-phase the scope shipped is `Done`, nothing unbuilt is, and each open item is still open in the code. A wait is the blocked row's status (`Blocked: <what is needed>`), never a row of its own.
- **Specs:** each exit item is done, or the spec says what was dropped. A spec describes what was built, not the first plan. A shipped spec ends with `## Notes from the build`, and each lesson there names where it also went (a checklist line, a skill, an `overview.md` rule, an area README) and is there; a lesson written only in the spec is a finding.
- **Reversals point back:** a later sub-phase that reverses an earlier one (a rename, a removal) has a one-line pointer in the older spec.
- **Where work sits:** a phase holds only features someone uses; code quality, security hardening, debt, an audit or a refactor is a checklist line, never a phase row. One feature has one row.
- **One home per rule, the right home:** each rule, reason and how-to sits in the one home its kind belongs in, by Where things go in `overview.md`: a rule in an Always line or a checklist line (plus its lint or script), a why in an ADR, a how-to in a guide, a README or a skill. A rule in two homes, or in the wrong one (a how-to in an ADR, a rule only in a spec), is a finding.
- **Docs move with every change:** whoever adds, changes, renames or removes a thing updates, in the same change, its spec, the area README, any guide that describes it and the board skill when agents see it; only the docs for what changed.
- **Always-loaded rules pass a test:** every rule in `overview.md` passes one of two tests: breaking it is irreversible (data, secrets, what leaves the Mac), or it applies to nearly every change. A rule that passes neither moves to its checklist. A checklist-only rule that passes a test is a finding.
- **An enforced rule is one line:** a rule enforced by lint or a script is one line in `overview.md` naming its enforcer, no more.
- **Built versus planned:** no doc describes something unbuilt as if it works (a command marked "to add" is not run as if it exists), and nothing built is still marked as coming. A doc naming a tool the code no longer uses (pnpm, Turborepo, Vitest, Node, SQLite) is a finding.
- **Commands table:** every command added in scope has its line in `overview.md`, and what it says the command does is what the script does.
- **Routes:** every route added or changed in scope has an `operationId`, a summary, a tag and descriptions that read well as an MCP tool, and the statuses it really answers.
- **The same name on every surface:** one capability has one name in the API, `flockr`, the MCP server and the web app ("claim", never "take" in one and "claim" in another).
- **CLI and MCP text:** each command's help and each tool's description says what it does, what it needs and what it refuses, in plain words.
- **Examples run:** run every command and request a doc shows, exactly as written, against the local stack or with `--help`. Report any that fails or answers differently from what the doc says.
- **Numbers and lists from one place:** a limit, a state list or a member kind in prose matches its one definition in `packages/contracts`. Prefer a pointer to the definition over a typed-out copy that will drift.
- **Right folder, right name, one theme:** each doc sits in the folder for its kind and follows its naming rule (Where things go in `overview.md`); `docs/` holds Markdown only and every other file sits in `docs/reference/`. Every doc is grouped by one theme, the question a reader asks; current docs never mention old ids or closed plans (where a thing came from lives in history).
- **Reviews index:** every file in `docs/reviews/` has its row in `docs/reviews/README.md` with a true Open count, and every row has its file.
- **ADRs:** a real decision in scope has its ADR and its row in `docs/decisions/README.md`; no accepted ADR was rewritten, and a reversal supersedes, changing only the old one's status line. An ADR holds the why only: no build order, commands or open questions.
- **Read as a newcomer:** could a fresh session find where to start and what is in flight from the Start here files alone? Could an agent work a task from the board skill alone?
- **Tables:** every table row has as many cells as its header.
- **Copy:** plain words, short sentences, one idea a paragraph, lists for enumerations, a small table for compared values, no emojis, no em dashes or double hyphens in prose, no dates in plans.
- **Privacy:** no real person's message, email address, token or key in any doc or example; examples use the invented chain (#806, #808, #812) and invented names.

Severity: high when a reader following the doc fails or is misled about identity, claims or what leaves the Mac; medium when a built capability is wrong or missing; low when stale, unclear or inconsistent.

The review file adds "Automated checks", an "Examples run" table (doc, example, result) and a "Coverage" list: each capability or command in scope and where it is documented.

## Learned from reviews

Each line is a class of mistake an earlier review caught, added by that review's run (step 5 of the skill), with the review file it came from. Check every line here as well as the checks above.
