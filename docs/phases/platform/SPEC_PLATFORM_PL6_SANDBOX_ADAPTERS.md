# PL6 Sandbox adapters

Part of the Platform track ([README](README.md)); [ADR 0007](../../decisions/0007-sandbox-runtime-is-agnostic.md) (one interface, adapters per provider), [ADR 0019](../../decisions/0019-coding-agents-run-claude-code-in-a-disposable-sandbox-per-task.md) (a box per task, keeps nothing), [ADR 0036](../../decisions/0036-a-cloud-agent-is-a-runner-of-one-inside-its-durable-object.md) (cloud agents), [ADR 0037](../../decisions/0037-cloud-agent-tools-run-in-a-box-per-task-the-loop-stays-outside.md) (this item's choices). Needs PL2.

## Problem

A cloud agent (4c) has only board tools: it cannot read a repo, edit a file or run a test. The sandbox interface and its Docker adapter exist (`pl6-docker-sandbox`), but nothing runs boxes on Cloudflare, nothing sweeps them, and no agent uses one.

## Scope

- **Interface** (`packages/sandbox/src/sandbox.ts`), small additions every adapter implements: the state `asleep`; `RunOptions.signal` (stop one command) and `maxOutputBytes` (keep the tail, default 1 MiB per stream); `RunResult.truncated`. The fixed box layout is one definition: `sandboxWorkspace` (`/workspace`, also `HOME`) and `sandboxUser` (1000:1000). A shared contract (`test/contract.ts`) every adapter passes.
- **Box image** `packages/sandbox/box/Dockerfile`: Debian trixie slim with git, bash, ripgrep, curl, ca-certificates and `setpriv`; user 1000; `/workspace` owned by it. Used by the Cloudflare adapter and usable with Docker.
- **Cloudflare Containers adapter** (`apps/server/src/platform/cloudflare/sandbox.ts`), on the `durable_object` scheduling policy, driving `ctx.container` directly (no server inside the image):

  | Rule | How |
  |---|---|
  | One object per box | `SandboxBox` Durable Object, `idFromName(<box id>)`; its spec, labels, expiry, snapshot and a short log in its storage |
  | Least power | Every command runs through `setpriv` as 1000:1000 with every capability, the bounding set and new privileges dropped (deployed containers give every process root's capabilities whatever `user` says); the root filesystem is root's, so the box user cannot write outside `/workspace` and `/tmp` |
  | Disk cap | `instance: { vcpu, memoryMib, diskMb }` per box, clamped to the platform's range (disk at least 2000 MB, at most 20 GB; memory 256 MiB to 12 GiB; 1/16 to 4 vCPU) |
  | Time limit | The container's only process is `sleep <remaining seconds>`, and the object's alarm destroys it at `expiresAt`; a command never outlives its `timeoutSeconds` (killed) |
  | Network | `network: "none"` starts it with `enableInternet: false`; `open` with true |
  | Sleeps when idle | After 5 idle minutes the alarm snapshots the container and destroys it (`asleep`); the next call restores the snapshot, so files survive; the platform inactivity timeout is set longer, as a backstop |
  | Labels | Kept in the object (the platform's 10 labels are lost on restore) and passed to `start` |
  | Clean-up and list | `SandboxIndex`, one object, keeps live box ids and expiries; a box removes itself when stopped or expired; `list()` reads the index |

  Off until the `SANDBOX` and `SANDBOX_INDEX` bindings exist. They are in the local (`wrangler dev`) config only; production has none until Containers are on the account.
- **Sweeper caller:** the Worker's minute cron runs `sweepSandboxes` when `SANDBOX` is bound.
- **Cloud agent tools** (`apps/runner/src/harness/pi/box-env.ts`, `apps/runner/src/cloud/boxes.ts`): a box per thread, made on the first file or shell call through Pi Durable's `env`, asleep between calls where the provider sleeps, stopped when the thread's task is done or canceled, or at its time limit. The tools are `read`, `write`, `edit` and `bash` in `/workspace`. The model loop stays in the agent's Durable Object; the box gets no secrets and no model key (PL8). `CloudAgent` passes `cloudflareSandbox(env)` when bound; tests pass the Docker adapter.
- **Harness gaps from the benchmarks**, for Pi in a box: `bash` stays `replay: "unsafe"`, so a command a crash cut off is never run again (the model gets an `interrupted` result); every command gets a default timeout of 120 s, at most 900 s; a reply cut off at the output limit (`stopReason: "length"`) continues the run with "carry on" up to 3 times.

**Out:** a Bun or VPS caller for the Docker sweeper (no Bun host runs cloud agents yet); Claude Code inside a box (ADR 0019 coding path, 4d); a GitHub token in the box (PL7); Cloudflare Computer, Blaxel, E2B; streaming a command's output while it runs (it arrives when the command ends); production bindings.

## Surfaces

No route, MCP tool, `flockr` command or web control: boxes are machine state an agent's tools use, not something people act on. A cloud agent's tool calls show in its thread's activity entry as today.

## Rules the tests hold

- `packages/sandbox/test/docker.test.ts` and the same contract through the Cloudflare adapter in local `wrangler dev` (`bun run --cwd apps/server sandbox:contract`, slow, not in `bun run check`): non-root, files kept, stdin, env, cwd, exit codes, a timed-out command, stop twice, read-only root, a time limit, the sweeper, `network: none`.
- Cloudflare only (same script): a box that slept keeps its files and wakes on the next call.
- `apps/runner/test/box.test.ts` against Docker: Pi's real `read`, `write`, `edit` and `bash` work in a box; a `bash` call cut off by a crash is not run again; a command with no timeout stops at the default; a reply cut at the output limit carries on.
- `apps/server/test/cloud-agents.test.ts`: a cloud agent's first shell call makes one box for the task, later calls reuse it, the task's completion stops it, and the box's environment holds no model key.

## Steps for Simon

- [ ] Turn on Containers for the account (Workers Paid), then add the `containers`, `SANDBOX`, `SANDBOX_INDEX` bindings and migration to the production environment in `apps/server/wrangler.jsonc` (copy the local ones) and deploy.
- [ ] Decide the box size for cloud agents (now 4 GB disk, 2 GiB memory, 1 vCPU, 4 hours, internet on) and whether boxes may reach the internet before PL7 limits what they can push.

## Exit checklist

- [x] Spec, ADR 0037, sandbox README and Platform README row.
- [x] Cloudflare adapter, sweeper caller, cloud agent tools.
- [x] Contract passes against Docker and against local `wrangler dev`; `bun run check` passes.

## Notes from the build

- **No server in the image.** The current Workers runtime gives a Durable Object `ctx.container.exec` (argv, cwd, env, stdin, `kill`), per-box `instance` sizes, labels, `enableInternet` and `snapshotContainer`, so the adapter drives the box directly. All of it works in local `wrangler dev` with Docker (wrangler 4.160), including snapshot and restore.
- **`exec` does not get `start`'s env** (only `PATH`), so the object keeps the spec's env and passes it with `PATH` and `HOME` on every command.
- **`user` is not a boundary when deployed**: every process has root's capabilities. Commands run as root through `setpriv`, which drops to 1000:1000 and clears the bounding set; locally the same wrapper shows `CapEff 0` and a refused write to `/etc`. Local containers also start with SYS_ADMIN and `/dev/fuse`, so the drop matters there too.
- **A box must not sleep mid-command**: idle is counted from the end of the last call, and the alarm never sleeps a box with a command running (a 15-minute command outlives the 5-minute idle).
- **Labels are lost on a snapshot restore**, and the platform takes at most 10 short ones; the object keeps them.
- **Tested in local `wrangler dev`, end to end:** a cloud agent with a local fake model was offered `read`, `write`, `edit`, `bash`; its `bash` call made a real container box for task 826, printed `uid=1000(box)` with no key, token or flockr variable in the box's environment; cancelling the task removed the container.
- **Not tested:** anything on Cloudflare's network (Containers are off on the account): deployed `setpriv`, the disk size (local Docker does not enforce `diskMb`), snapshot cost and timing, the platform inactivity stop, cold starts. Nothing was deployed.
- **Production config:** `wrangler deploy --env production` now warns that `SANDBOX`, `SANDBOX_INDEX` and `containers` are top-level only. That is on purpose until Containers are on the account; the production bundle builds and has no sandbox bindings, so cloud agents there keep board tools only.
- **Pi's own tools fit the box unchanged.** Pi's `read`, `write`, `edit` and `bash` go through `env`, so `box-env.ts` implements its `ExecutionEnv` with shell commands in the box (`stat`, `cat`, `mv`, `mktemp`). Watching files is not supported. A crash leaves `bash` unrun, because it is not replay-safe (the default); the test kills the home mid-command and checks the command ran once.
- **Output limit:** Pi ends a run on `stopReason: "length"` as if it were an answer; an `onYield` hook (`carryOnExtension`, on every Pi agent) continues it up to 3 times in a row.
