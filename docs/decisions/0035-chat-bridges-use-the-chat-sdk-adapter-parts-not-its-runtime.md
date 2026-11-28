# 0035. Chat bridges use the Chat SDK's adapter parts, not its runtime

Status: Accepted (28 Nov 2026, 5d)

## Problem

5d syncs Slack threads with board threads both ways, with buttons for cards. Simon chose Vercel's Chat SDK (`chat` with `@chat-adapter/slack`) inside one bridge adapter, the way 5e's `github` code host works. The SDK's `Chat` runtime wants its own state store (Redis or memory) for dedupe, thread subscriptions and locks, and runs handlers inside the webhook request.

## Options

1. **The whole runtime:** `new Chat({ adapters: { slack }, state })` with `onSubscribedMessage` and `onAction` handlers, plus a state adapter.
2. **The adapter's standalone parts:** `@chat-adapter/slack/webhook` (signature check, payload parsing) and `@chat-adapter/slack/api` (post with a fetch we pass in), behind a Flockr `ChatBridge` interface; Postgres holds the links, `hook_deliveries` the request keys, and the jobs table (ADR 0020) the outbound posts.
3. **Hand-written Slack code:** our own HMAC check and `fetch` calls.

## Choice

Option 2. Flockr already has one place for each thing the runtime would hold: request keys in `hook_deliveries`, retries and locks in `jobs`, the mapping in Postgres where `canSee` and the event log can see it. A second state store would split that, and on Cloudflare it would be one more binding. The standalone parts are fetch-based with no Slack SDK or socket dependency, run on Bun and Workers, and take an injected `fetch`, so tests run against a fake Slack. We still get the maintained signature check and payload parser rather than writing our own.

## Costs

- Channel `message` events are not parsed by the standalone parser (it returns them as `unsupported` with the raw event); the adapter decodes them with Zod.
- Streaming replies, modals and the SDK's cross-platform cards are not used; adding them later means taking more of the SDK or writing Block Kit by hand, as 5d does for buttons.
- A second chat platform is one more `ChatBridge` adapter and one entry in `chatBridges`.
