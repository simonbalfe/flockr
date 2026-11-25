# 0024: The board is the model key proxy, reached with signed box tokens

Status: accepted, 25 Nov 2026. Decided by the agent building PL8, as a small reversible choice. Builds on [0007](0007-sandbox-runtime-is-agnostic.md) (the model key stays outside every sandbox) and [0019](0019-coding-agents-run-claude-code-in-a-disposable-sandbox-per-task.md).

## Problem

A harness in a sandbox calls a model, and a sandbox runs code nobody reviewed. If the model key is in the box, one bad dependency can copy it out. The box needs a way to reach the model that is worth nothing once the box is gone.

## Options

| Option | Good | Cost |
|---|---|---|
| A separate egress proxy service | Can also filter all other traffic | One more thing to run and pay for |
| The board forwards model calls at `/api/model/*`; boxes hold a signed box token | Nothing new to run: the Worker or the Bun server already holds secrets; works on every platform | Model traffic goes through the board; general egress filtering is still separate |
| Box tokens stored in Postgres | Can be revoked one by one | A table and a lookup on every model call |

## Choice

The board is the proxy. A box gets `fbx_<claims>.<signature>`: its id and expiry, signed with HMAC-SHA256 from the board's sign-in secret, valid no longer than the box's time limit. The board checks it, drops the box's own credentials, cookies and member header, adds the real key (`FLOCKR_MODEL_KEY` in the header `FLOCKR_MODEL_KEY_HEADER`) and forwards to `FLOCKR_MODEL_BASE_URL`, streaming the answer back. The token is accepted as `Authorization: Bearer` or `x-api-key`, so any harness can point its base URL at the board. No provider is named in code.

## Why

No new service and no table; the key exists only in the board's secrets. A stolen box token stops working when the box's time limit does.

## Costs

- A token cannot be revoked early; rotating the sign-in secret revokes every token at once.
- It is not an OpenAPI operation, so it has no MCP tool or `flockr` command: it is for sandboxes, not for members.
- Other outbound traffic from a box is not filtered here; `network: "none"` or a later egress policy covers that.
