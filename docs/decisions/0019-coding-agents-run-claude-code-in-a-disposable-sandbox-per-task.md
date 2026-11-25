# 0019: Coding agents run Claude Code in a disposable sandbox per task; other cloud agents run Pi Durable

Status: proposed, 25 Nov 2026. Recommended in chat, not yet confirmed by Simon. Builds on [0007](0007-sandbox-runtime-is-agnostic.md), [0013](0013-the-runner-launches-agents-through-harness-adapters.md) and [0017](0017-flockr-runs-on-cloudflare-through-platform-adapters.md). Would supersede in part [0008](0008-pi-durable-is-the-built-in-agent-harness.md) (Pi Durable as the harness for hosted coding agents).

## Problem

A cloud coding agent must clone a repo, edit it, run its tests and hand back a pull request with nobody watching. Two shapes were weighed: Claude Code running inside the sandbox, or Pi Durable outside it calling the sandbox for each tool. The sandbox also needs a rule for what it keeps.

## Options

| Option | Good | Cost |
|---|---|---|
| **Claude Code, headless, inside a sandbox per task** | Strongest coding tools today; reuses the runner's Claude Code adapter | Claude only; the box stays awake for the whole run; the model key must be proxied |
| Pi Durable outside, sandbox tools per call | Crash-safe at every step; any model; the box can sleep between tool calls (about a quarter of the box bill) | Flockr writes and tunes the coding tools and prompts |
| Codex in a sandbox | Second strong harness | Same shape as Claude Code; one more adapter |

## Choice

- **Coding tasks:** a sandbox per task through the sandbox interface (0007): Cloudflare Containers first, Docker locally, Blaxel or E2B as optional overflow adapters. Claude Code runs in it headless, resuming its session with `--resume` between turns.
- **Other cloud agents** (triage, summaries, routines): Pi Durable in an agent Durable Object (0018), with Cloudflare Computer for files and light scripts.
- **The sandbox keeps nothing that matters.** Work leaves only as git pushes: after each turn that changed files the runner commits and pushes to `flockr/<task>`; a new box clones that branch and carries on.
- **Short-lived access.** A GitHub App gives each box a token for one repo that expires within the hour; boxes push only `flockr/<task>` branches; merging waits for a person. The model key stays outside the box behind an egress proxy (0007).
- **Measure later.** Run the same 10 coding tasks through Pi Durable with sandbox tools; move coding over if its pull requests are as good.

## Why

Coding quality decides whether a cloud agent's pull request is worth reviewing, and the Claude Code adapter already exists. Git as the only way out keeps every sandbox provider swappable.

## Costs

- Cloud runs bill an API key, not a Claude subscription.
- A box dying mid-turn loses that turn; work-in-progress commits limit the loss to one turn.
- Sandboxes run as root by default on some providers, and Claude Code refuses `--dangerously-skip-permissions` as root: use a non-root image user or an explicit tool allow-list.
- Work-in-progress commits are squashed before merge.
