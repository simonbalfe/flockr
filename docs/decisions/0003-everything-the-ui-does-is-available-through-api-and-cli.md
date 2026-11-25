# 0003: Everything the UI can do is available through the API and CLI

Status: accepted, 24 Nov 2026. Restates design choice 1 in the architecture guide as a rule.

## Problem

If the web app can do something agents cannot, agents get workarounds and the product drifts into a tool for people only.

## Options

| Option | Good | Cost |
|---|---|---|
| UI first, API later | Fast demos | Agents are second class; the API ends up incomplete |
| API first, UI is one client | Agents and people always agree; easy to test | Each feature needs a route and an `fc` command before its screen |

## Choice

Every action is an API route first. `fc` and MCP expose every route. The web app may only call routes that agents can also call. A feature is not done until it works headless.

## Why

Agents are members, not add-ons. One path for all clients also means one set of tests and one place for rules like claims and approvals.

## Costs

- Slower first screen for each feature.
- The `fc` command and MCP tool must ship with the route.
