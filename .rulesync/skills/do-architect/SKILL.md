---
name: do-architect
description: Sketch the shape of a change before any code (types, signatures, which folder or package owns what, where the transaction, the sweeper or a job starts and stops), compare two shapes and record the chosen one in the sub-phase spec. Runs only when Simon types /do-architect or asks in his own words to architect or design a change; never on your own, never as a step or a gate.
targets: ["*"]
disable-model-invocation: true
---

# Architect

Adapted from pstack's `architect` skill (MIT, Lauren Tan; see `LICENSE`).

Where this skill and `CLAUDE.md` disagree, `CLAUDE.md` wins. Write no code until step 4 is done.

## 1. Trace what the change touches

- `docs/guides/GUIDE_ARCHITECTURE_MODEL.md`: the parts and design choices it crosses, and its "Where a change goes" row. A change that fits no row adds the part there first.
- List every part touched: tables and who writes them, events, board functions, routes, the MCP tools they become, `flockr` commands, web app screens, contracts lists, adapters, the sweeper and later jobs.

## 2. Sketch two different shapes

Two real alternatives, not one with a strawman. Each sketch names:

- The types and function signatures (discriminated unions on `kind`, the failure kinds, the Zod schema at each boundary; see the typescript checklist, `.rulesync/skills/review/typescript.md`).
- Which folder or package owns each piece of state and each function (`apps/server/src/board/`, `packages/contracts`, an adapter).
- Where each transaction starts and ends, which events it writes, and what crosses into the sweeper, a job or the live socket.
- How it reaches every surface (ADR 0003): the route, MCP, `flockr`, the web app.

## 3. Pick one

Pick the shape where:

- each piece of state has one owner,
- each task has one way to do it,
- callers know the least,
- no provider, harness or model is named outside its adapter (ADR 0009).

If the sketch keeps needing workarounds, redesign it instead of patching.

## 4. Record it

- In the sub-phase spec, under a `Design` heading: the chosen sketch, the rejected one, and one line on why.
- An ADR in `docs/decisions/` when it is a real decision (a tech choice, a boundary, a tradeoff or a reversal): problem, options, choice, why, costs, plus its row in `docs/decisions/README.md`. Link it from the spec.

## 5. Hand off

- Work spanning several agents: the `flow-plan` skill.
- Deciding which agent owns which files: the `flow-parallel` skill.
- Otherwise, build it by the Workflow steps in `CLAUDE.md`.
