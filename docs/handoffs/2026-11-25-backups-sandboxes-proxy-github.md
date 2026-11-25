# Handoff: backups, sandboxes, model proxy and GitHub sync, 25 Nov 2026

## Done

- **fix-cli-name-and-test-preload:** help, errors and docs say `flockr` (`fc` still works); a `bun test` preload migrates the test database before the first test, so a new migration no longer times one out.
- **PL4 backups (ADR 0023):** nightly logical copy of every table to the `FLOCKR_S3_*` bucket from the Worker's `0 3 * * *` cron, newest 30 kept; `bun run db:backup`, `bun run db:restore [key]`. Practised against a local S3 server: 185 rows out and back, event log identical.
- **PL6 Docker sandbox:** `packages/sandbox` with the interface, provider list, sweeper and Docker adapter (non-root, read-only root, tmpfs disk cap, removes itself at its time limit), held by a contract test against real Docker.
- **PL8 model proxy (ADR 0024):** boxes call `/api/model/*` with a signed box token; the board adds `FLOCKR_MODEL_KEY` and forwards to `FLOCKR_MODEL_BASE_URL`.
- **5e GitHub sync:** signed webhooks at `/api/hooks/github` put pull requests, reviews and comments on `flockr/<task>` branches into the task thread; merges add their commit.
- Local database migrated to 0013. `bun run check` passes.

## Blocked on Simon

| What | Unblocks |
|---|---|
| A working Neon connection string as `FLOCKR_DATABASE_URL` in Infisical (`PLAYGROUND_DATABASE_URL` points at Neon but its password is refused) | The deploy (PL4, PL10) |
| An R2 bucket `flockr` and an R2 S3 API token for it | Nightly backups on the deploy |
| Yes or no on ADR 0019 (Claude Code in a sandbox per task) | 4d |
| Containers on the Cloudflare account (Workers Paid) | PL6's Cloudflare adapter, 4c, 4d |
| A GitHub App (PL7), and a yes to spend on OpenRouter | PL5, 4c, 4d, posting back to GitHub |
| A Slack app and its tokens | 5d |

## Next: the deploy

The five steps in `2026-11-25-deploy-and-cloud-agents.md`, plus Worker secrets `FLOCKR_S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `FLOCKR_S3_BUCKET`, `FLOCKR_S3_ACCESS_KEY_ID`, `FLOCKR_S3_SECRET_ACCESS_KEY`, optionally `FLOCKR_HOOK_SECRET`; then `wrangler deploy --env production`, one manual `bun run db:backup` against Neon and one `bun run db:restore` into a scratch Neon branch.
