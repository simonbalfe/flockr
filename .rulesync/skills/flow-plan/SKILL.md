---
name: flow-plan
description: Write the plan for work that spans several sub-phases or agents, saying which parts run in parallel, which wait on which, the files each may touch and how each is verified, then stop. Use when Simon asks for a plan across sub-phases, before launching several agents, or says "plan 1b to 1e".
targets: ["*"]
---

# Phase plan

Adapted from pstack's poteto-mode `multi-phase-plan` playbook and `principle-sequence-verifiable-units` (MIT, Lauren Tan; see `LICENSE`).

You own the plan, not the code. The plan is a checklist an agent runs box by box and Simon audits from the evidence. Do not build anything.

## Steps

1. **Skip it when it is small.** One or two files with an obvious approach need no plan. Say so and stop.
2. **Settle open questions first.** Answer what a quick run can answer with a throwaway script in the scratchpad. Ask Simon only a product or preference call no run can settle.
3. **Write the plan** in the phase README (`docs/phases/phase-N/README.md`), under a `## Parallel plan` section:
   - What changes, in one line.
   - The sub-phases in landing order.
   - The dependency graph: which start at once, which wait for which, and why.
   - The files each may touch, with shared files resolved by the `flow-parallel` skill.
   - Who regenerates what after another agent's change lands (`bun run generate`, `bun run db:generate`, `bunx rulesync@26.0.0 generate`).
4. **One section per sub-phase**, each a unit that ends in a state you can check. Checkboxes for:
   - [ ] Depends on
   - [ ] Files it edits
   - [ ] The one change it builds
   - [ ] The result you can see on each surface (API, MCP, `flockr`, web app)
   - [ ] Verification: `bun run check`, plus a live check named with its scenario and pass rule (for example: two agents claim #806 at once, exactly one wins)
5. **Order units so each proves itself:** the failing test before the fix, the removal before the reshape, the baseline before the change. Each unit lands on its own.
6. **Hand back and stop.** Building starts only on Simon's go; then one agent per sub-phase, each in its own Herdr tab.

**Reply:** where the plan is, the sub-phases with their dependencies, which run in parallel, and what stays unproven.
