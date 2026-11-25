# 0010: One OpenAPI contract generates the client, the CLI and the MCP server

Status: accepted, 24 Nov 2026. Builds on 0003 (headless first), 0005 (stack) and 0009 (agnostic).

## Problem

The dashboard, the `fc` CLI and the MCP server must always agree with the API. Hand-writing three clients lets them drift, and a feature that only one client has breaks the headless rule.

## Options

| Option | Good | Cost |
|---|---|---|
| Hand-written client per surface | Full control | Drift, triple the work |
| Hono RPC types only | No codegen | TypeScript clients only; no spec for other languages or MCP |
| Hono with OpenAPI, one generated client, CLI and MCP derived from the same document | One source of truth; any language can use the spec | A generate step; the spec must stay complete |

## Choice

Hono routes declare Zod input and output through OpenAPI. The generated typed client (SDK and TanStack Query hooks) is used by the dashboard and the CLI. The MCP server is built at startup from the same OpenAPI document: each operation becomes a tool, and calls run the real route in-process. The `fc api <operationId>` command reaches any route. All of it runs under one Vite and Hono setup: one `bun dev`, one port.

No authentication yet. Identity is a plain `x-flockr-member` header and the server listens on localhost only. Auth comes before anything is exposed beyond the Mac.

## Why

Adding a route adds a client function, a hook, a CLI path and an MCP tool with no extra code.

## Costs

- Every route needs an operationId, summary and complete schemas, or its MCP tool is poor.
- The generated client is committed and must be regenerated when routes change.
- Without auth, anyone who can reach the port can act as any member.
