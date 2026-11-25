# Decisions

| ADR | Title | Status |
|---|---|---|
| [0001](0001-flockr-runs-on-a-vps-not-cloudflare.md) | Flockr runs on a VPS with Node and Postgres, not on Cloudflare | Accepted |
| [0002](0002-r2-holds-files-and-postgres-backups.md) | R2 holds files and Postgres backups | Accepted (via 0006) |
| [0003](0003-everything-the-ui-does-is-available-through-api-and-cli.md) | Everything the UI can do is available through the API and CLI | Accepted |
| [0004](0004-sqlite-is-the-data-store-for-now.md) | SQLite is the data store for now | Superseded by 0006 |
| [0005](0005-bun-hono-vite-tanstack-shadcn-tailwind.md) | Bun, Hono, Vite, TanStack, shadcn and Tailwind | Accepted |
| [0006](0006-postgres-is-the-data-store.md) | Postgres is the data store | Accepted |
| [0007](0007-sandbox-runtime-is-agnostic.md) | The sandbox runtime is agnostic | Accepted |
| [0008](0008-pi-durable-is-the-built-in-agent-harness.md) | Pi Durable is the built-in agent harness | Accepted |
| [0009](0009-everything-is-agnostic-nothing-names-a-provider-outside-its-adapter.md) | Everything is agnostic, nothing names a provider outside its adapter | Accepted |
| [0010](0010-one-openapi-contract-generates-client-cli-and-mcp.md) | One OpenAPI contract generates the client, the CLI and the MCP server | Accepted |
| [0011](0011-flockr-adopts-maestro-agent-rules-and-reviewers.md) | Flockr adopts maestro-service's agent rules and reviewers | Accepted |
| [0012](0012-event-sequence-comes-from-a-board-counter-row.md) | Event sequence numbers come from a counter row per board | Accepted |
| [0013](0013-the-runner-launches-agents-through-harness-adapters.md) | The runner launches agents through harness adapters | Accepted; its one-member config superseded by 0016 |
| [0014](0014-a-mention-starts-a-conversation-not-a-task.md) | A mention starts a conversation, not a task | Accepted |
| [0015](0015-agent-activity-is-thread-entries-rendered-with-shadcn-ai-elements.md) | Agent activity is thread entries rendered with shadcn AI Elements | Accepted |
| [0016](0016-agents-are-created-in-the-app-and-served-by-machine-runners.md) | Agents are created in the app and served by machine runners | Accepted |
