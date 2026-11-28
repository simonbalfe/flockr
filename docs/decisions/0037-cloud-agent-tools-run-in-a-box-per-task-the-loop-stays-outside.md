# 0037. A cloud agent's tools run in a box per task; the loop stays outside

Status: Accepted (28 Nov 2026, PL6). Decided by the agent building PL6 within Simon's brief ("loop outside, files only in the box"; research in `docs/reference/RESEARCH_CLOUD_AGENTS.html`, section 9). Builds on [0007](0007-sandbox-runtime-is-agnostic.md), [0024](0024-the-board-is-the-model-key-proxy.md), [0036](0036-a-cloud-agent-is-a-runner-of-one-inside-its-durable-object.md). Leaves [0019](0019-coding-agents-run-claude-code-in-a-disposable-sandbox-per-task.md) (Claude Code inside a box for coding) proposed: this is the Pi Durable path it set against it.

## Problem

A cloud agent (4c) needs files and a shell to do real work, and Cloudflare Containers are the first cloud sandbox. Three things had to be settled: where the agent loop runs, how a Worker drives a container, and what keeps the box's rules (ADR 0007) on a platform where every deployed process has root's capabilities.

## Options

| Option | Good | Cost |
|---|---|---|
| The harness inside the box (ADR 0019's shape) | One process does everything | The box stays awake for the whole run; the model key or a token must be inside; a crash loses the turn |
| **Pi Durable in the agent's Durable Object, its tools in the box through `env`** | Crash-safe per step; the box sleeps between calls; nothing secret inside; any model | Flockr owns the tools' environment (`box-env.ts`) |
| A control server inside the image, reached over HTTP | Works with any container API | One more program to build, secure and version |
| **`ctx.container.exec` from one Durable Object per box (`durable_object` scheduling policy)** | No server in the image; per-box image, size, network and snapshots | Cloudflare's newer policy, in beta |

## Choice

- The loop stays in `CloudAgent`; `read`, `write`, `edit` and `bash` reach a box through Pi Durable's `env`. A box is made per thread on first use, sleeps between calls where the provider can, and is stopped when the task is done or canceled, or at its time limit. The box gets no secrets.
- The Cloudflare adapter is one `SandboxBox` Durable Object per box driving `ctx.container` directly, plus one `SandboxIndex` object for `list()`. Every command runs through `setpriv` as 1000:1000 with all capabilities, the bounding set and new privileges dropped, because `exec`'s `user` does not restrict a deployed process. Sleep is a container snapshot and destroy after 5 idle minutes; the next call restores it.
- `bash` stays not replay-safe, gets a default timeout, and a reply cut off at the output limit carries on (the benchmark gaps).

## Why

The research verdict: crash-safety and a sleeping box come from keeping the loop outside, and a box that holds nothing secret cannot leak it. Driving `exec` from the object keeps the image a plain Debian with git, so the same image works with Docker.

## Costs

- Each tool call is a Durable Object request to the box, and a file read is a `cat` in the box: slower than local files. Output arrives when a command ends, not while it runs.
- Each sleep makes a full-filesystem snapshot (about 180 MB for the plain image), kept 30 days by the platform with no delete call. Directory snapshots of `/workspace` only are in Cloudflare's experimental API; switch when they are stable.
- The disk cap cannot go below the platform's 2 GB, and local `wrangler dev` does not enforce it.
- Local containers run with extra Docker privileges (SYS_ADMIN, `/dev/fuse`); the dropped capabilities are what keep box commands from using them.
