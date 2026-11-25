# @flockr/sandbox

Where a cloud agent's work runs (ADRs 0007, 0019). One `SandboxProvider` interface, one adapter per provider, one entry in `providers` (`src/index.ts`). A feature reads `capabilities`, never a provider's name.

```ts
const sandbox = sandboxFor("docker")
const box = await sandbox.start({ image: "alpine:3.20", timeLimitSeconds: 3600, diskMb: 2048, labels: { task: "806" } })
await sandbox.writeFile(box.id, "plan.md", "# Users table")
const result = await sandbox.run(box.id, ["git", "clone", "--branch", "flockr/806", repoUrl, "repo"])
await sandbox.stop(box.id)
```

Every box has a time limit, a disk cap and clean-up:

| Rule | Docker adapter |
|---|---|
| Time limit | The box's only process is `sleep <limit>` with `--rm`, so it removes itself; `sweepSandboxes` is the backstop |
| Disk cap | Read-only root; `/workspace` (also `HOME`) is one tmpfs of `diskMb`, `/tmp` is 64 MB; memory is raised by `diskMb` because tmpfs counts against it |
| Least power | User 1000, all capabilities dropped, no new privileges, 512 processes, `network: "none"` for no network |
| Keeps nothing | Work leaves only as git pushes (ADR 0019) |

`bun run test` here runs the contract test against real Docker and skips it when Docker is not running. A new adapter passes the same test.

The model key never enters a box: give it `FLOCKR_MODEL_URL=<board>/api/model` and a box token from `issueBoxToken` (expiring with the box), and the board adds the real key (PL8, ADR 0024).
