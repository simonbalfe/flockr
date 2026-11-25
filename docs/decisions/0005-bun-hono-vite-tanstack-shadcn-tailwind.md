# 0005: Bun, Hono, Vite, TanStack, shadcn and Tailwind

Status: accepted, 24 Nov 2026. Supersedes the Node runtime choice in the architecture guide. Frontend is built first, with no backend.

## Problem

The plan named Node 22 and pnpm because maestro-service uses them. Flockr is a separate local-first product with one server and SQLite, and the first thing to build is the interface.

## Options

| Option | Good | Cost |
|---|---|---|
| Bun | Built-in SQLite, WebSocket and HTTP; runs TypeScript directly; `flarebot-flue` already runs on it | Smaller ecosystem; rare native-package edge cases |
| Node 22 with pnpm | Most boring, matches maestro-service | A native SQLite add-on and more tooling |

## Choice

Bun as runtime and package manager. Server: Hono. Web app: Vite, React, TanStack Router and Query, shadcn/ui and Tailwind. Build the web app first against a fake in-memory data layer; the real Hono server replaces that layer later with no change to the screens.

## Why

Fewest moving parts for a one-server SQLite product. Hono, Drizzle and the whole frontend stack run on Bun and Node, so a move back is cheap.

## Costs

- Different runtime from maestro-service.
- Any package that needs a Node-only native module must be checked before use.
