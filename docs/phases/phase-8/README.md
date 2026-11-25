# Phase 8: Codebase coordination

Done when two agents on different machines work one repo, each sees what the other is touching, and neither overwrites the other's work. All three sub-phases are in one spec: [SPEC_PHASE_8_CODEBASE_COORDINATION.md](SPEC_PHASE_8_CODEBASE_COORDINATION.md).

| Sub-phase | Focus | Why this order |
|---|---|---|
| 8a Working areas | See what others are touching | The board must know who is where before anything can avoid a clash |
| 8b A branch per task | Never share a checkout | Areas warn; the branch and worktree make a clash harmless |
| 8c Hand-offs | Move work between members | Needs the branch and areas to move with the task |
