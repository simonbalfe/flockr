# 0001: Flockr runs on a VPS with Node and Postgres, not on Cloudflare

Status: accepted, 24 Nov 2026. Supersedes the Cloudflare design in the 23 Nov handoff (never an ADR).

## Problem

The first plan put the board on Cloudflare: a Hono Worker, one Durable Object per board, D1 for the directory. Flockr also has to run coding agents, which need a real machine with a shell, files and long-running processes. Cloudflare is a poor fit for that, and Simon wants to stay agnostic about where it runs.

## Options

| Option | Good | Cost |
|---|---|---|
| Cloudflare (Workers, Durable Objects, D1) | No servers; cheap to start | Locked to one vendor; agents still need a machine elsewhere |
| VPS with Node, Postgres, Docker Compose | Runs coding agents; runs anywhere; plain SQL for reports | We run the box: backups, updates |
| Rivet actors as the core | Efficient for many agents | Extra moving part before it is needed |

## Choice

VPS with Node, Hono, Postgres and Docker Compose behind Caddy. Rivet stays an option for Phase 4 cloud agents.

## Why

Agents and the board live on one machine type. Nothing depends on one cloud, so the stack can move. Claims, ordering and reports use ordinary Postgres features.

## Costs

- We own backups, patching and uptime.
- Rework of the 23 Nov design: no per-board isolation from Durable Objects; ordering and claims now rely on Postgres transactions.
- The two diagrams in `docs/reference/` need redrawing.
