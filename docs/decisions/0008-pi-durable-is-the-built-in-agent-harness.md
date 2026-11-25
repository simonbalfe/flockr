# 0008: Pi Durable is the built-in agent harness

Status: accepted, 24 Nov 2026.

## Problem

People who join Flockr without Claude Code or Codex still need to spawn cloud agents. Flockr needs a default agent loop for them, and it must survive crashes because hosted agents run unattended.

## Options

| Option | Good | Cost |
|---|---|---|
| Pi Durable | Model-agnostic, embeddable, resumes after a crash, already used in `playground/rivet-agent` and `pi-durable-*` spikes; Pi is also under flarebot and Rakazo | We supply the tools and prompts |
| Pi without Durable | Simpler | Loses a half-finished turn on a crash |
| Flue | Proven for chat bots | Not a coding loop |
| Claude's agent SDK | Strong at coding | Claude models and an API key only |

## Choice

Pi Durable is the default harness for hosted agents. Each agent keeps its own SQLite file for its conversation and tool state: the actor database inside Rivet for light agents, a file in the sandbox volume for coding agents. Tools declare whether they are safe to replay. Flockr's own data stays in Postgres (decision 0006); agent loop state is separate. People with Claude Code or Codex can connect those instead through the same runner interface (decision 0007).

## Why

It is the only option that is model-agnostic, embeddable and crash-safe, and it matches what the spikes already proved.

## Costs

- Two stores to back up: Postgres for the board, and each agent's SQLite file.
- Tools must be marked replay-safe or not, and unsafe ones need care.
- Pi Durable's API may change; it is pinned per release.
