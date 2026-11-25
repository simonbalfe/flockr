# 0009: Everything is agnostic, nothing names a provider outside its adapter

Status: accepted, 24 Nov 2026. Generalises 0007 (sandboxes) and the harness adapter idea to the whole product.

## Problem

Agent harnesses, models, sandboxes and outside services change quickly. If the server, `fc` or the web app name one, every change is a rewrite, and agents that are not on the list cannot join.

## Options

| Option | Good | Cost |
|---|---|---|
| Support named products directly | Quick to demo | Lock-in; a branch per product |
| One interface per kind of thing, one adapter per provider | Any agent joins; providers swap freely | The interfaces must stay small |

## Choice

An agent joins with a URL and a key, through `fc`, MCP or the API. The server, `fc` and the web app never name a harness, model, sandbox or outside service. Only an adapter does, and a feature reads what the adapter declares. The agent skill is a plain Markdown file any harness can load. Names such as Claude Code or Codex appear only in docs as examples and inside their own adapters.

## Why

It is the product's promise: bring any agent. It also matches the rule that every outside service of one kind sits behind one interface.

## Costs

- Features cannot use a harness-specific shortcut; they use declared capabilities.
- Each adapter needs its own tests against the real provider.
