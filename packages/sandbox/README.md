# @flockr/sandbox

Where a cloud agent's work runs (ADRs 0007, 0019, 0037). One `SandboxProvider` interface, one adapter per provider. A feature reads `capabilities`, never a provider's name. `@flockr/sandbox/sandbox` is the interface alone, safe to import in a Worker; `@flockr/sandbox` adds the provider list (`docker`), which spawns processes.

```ts
const sandbox = sandboxFor("docker")
const box = await sandbox.start({ image: "alpine:3.20", timeLimitSeconds: 3600, diskMb: 2048, labels: { task: "806" } })
await sandbox.writeFile(box.id, "plan.md", "# Users table")
const result = await sandbox.run(box.id, ["git", "clone", "--branch", "flockr/806", repoUrl, "repo"], { timeoutSeconds: 120 })
await sandbox.stop(box.id)
```

| Adapter | Where | Sleeps when idle |
|---|---|---|
| `docker` | `src/docker.ts`, this machine and self-hosting | No |
| Cloudflare Containers | `apps/server/src/platform/cloudflare/sandbox.ts` (`cloudflareSandbox(env)`), because it needs bindings; one `SandboxBox` Durable Object per box | Yes: a snapshot after 5 idle minutes, restored on the next call |

Every box has a time limit, a disk cap and clean-up:

| Rule | Docker | Cloudflare Containers |
|---|---|---|
| Time limit | The box's only process is `sleep <limit>` with `--rm`; `sweepSandboxes` is the backstop | The same `sleep`, plus the object's alarm destroys it at `expiresAt`; the minute cron runs `sweepSandboxes` |
| Disk cap | Read-only root; `/workspace` (also `HOME`) is one tmpfs of `diskMb`, `/tmp` 64 MB; memory is raised by `diskMb` because tmpfs counts against it | The instance's disk of `diskMb`, at least 2000 MB (the platform minimum), at most 20 GB |
| Least power | User 1000, all capabilities dropped, no new privileges, 512 processes | Every command through `setpriv` as 1000:1000 with all capabilities and the bounding set dropped; the root filesystem is root's |
| Network | `none` has no network | `none` starts it with `enableInternet: false` |
| A command | `timeoutSeconds` kills it (inside the box too); output keeps the last `maxOutputBytes` (1 MiB) per stream, `truncated` says so | The same, through `exec` and `kill` |
| Keeps nothing | Work leaves only as git pushes (ADR 0019) | Same; a snapshot lives only while the box sleeps |

The box image for agents is `box/Dockerfile`: Debian trixie slim with bash, git, ripgrep, curl and `setpriv`, user 1000, `/workspace`. The Cloudflare adapter needs `setpriv` in any image it runs.

`bun run test` here runs the shared contract (`test/contract.ts`) against real Docker, skipped when Docker is not running. The Cloudflare adapter passes the same contract in local `wrangler dev` with `bun run --cwd apps/server sandbox:contract` (slow, builds the box image; not in `bun run check`). A new adapter passes the same contract.

The model key never enters a box. A cloud agent's loop runs outside the box and calls the model itself (ADR 0037); a harness that runs inside a box gets `FLOCKR_MODEL_URL=<board>/api/model` and a box token from `issueBoxToken` (expiring with the box), and the board adds the real key (PL8, ADR 0024).
