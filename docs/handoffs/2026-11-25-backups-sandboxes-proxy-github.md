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
| A yes to delete the retired `creator-crawl` Neon project (its dumps are in R2) | Nothing; tidying |
| Yes or no on ADR 0019 (Claude Code in a sandbox per task) | 4d |
| Containers on the Cloudflare account (Workers Paid) | PL6's Cloudflare adapter, 4c, 4d |
| A GitHub App (PL7), and a yes to spend on OpenRouter | PL5, 4c, 4d, posting back to GitHub |
| A Slack app and its tokens | 5d |

## Next: the deploy

The five steps in `2026-11-25-deploy-and-cloud-agents.md`, plus Worker secrets `FLOCKR_S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `FLOCKR_S3_BUCKET`, `FLOCKR_S3_ACCESS_KEY_ID`, `FLOCKR_S3_SECRET_ACCESS_KEY`, optionally `FLOCKR_HOOK_SECRET`; then `wrangler deploy --env production`, one manual `bun run db:backup` against Neon and one `bun run db:restore` into a scratch Neon branch.

## Deployed, 25 Nov 2026

- Live at `https://flockr.simonbalfe.com` with sign-in on. Neon `flockr` in the personal org (`neonctl --config-dir ~/.config/neonctl-personal`), Hyperdrive `flockr-db`, R2 bucket `flockr`; secrets `FLOCKR_DATABASE_URL`, `FLOCKR_S3_*` and `FLOCKR_HOOK_SECRET` in Infisical.
- Checked: the page serves, `/api` refuses without sign-in, an unsigned webhook gets 401, a magic link request stores its token in Neon through Hyperdrive, and a backup of Neon reached R2.
- Redeploy: `bun run build`, then from `apps/server`: write the five secrets (`FLOCKR_PEOPLE`, `FLOCKR_AUTH_SECRET`, `FLOCKR_S3_ACCESS_KEY_ID`, `FLOCKR_S3_SECRET_ACCESS_KEY`, `FLOCKR_HOOK_SECRET`) from `sec` to a JSON file, `CLOUDFLARE_ACCOUNT_ID=ac4542261404facc325b2e023535b26a bunx wrangler deploy --env production --secrets-file <file>`, delete the file. Migrations: `sec run -- zsh -c 'DATABASE_URL=$FLOCKR_DATABASE_URL bun run db:migrate'` before the deploy.

## Agents on the live board, 25 Nov 2026

| Agent | Machine | Runner |
|---|---|---|
| `claude` | Simon's Mac (`simons-mac`) | `FLOCKR_HOME=~/.flockr-live bun run runner` from the repo; config and key in `~/.flockr-live/runner.json`; stops when the Mac or session does |
| `claude-vps` | Hetzner `simon-vps` | systemd `flockr-runner` as user `flockr`, repo clone in `/home/flockr/flockr`, config and its own key in `/home/flockr/.flockr/runner.json`, Claude Code signed in as Simon (subscription) |

- Update the VPS runner: `ssh vps`, then `su - flockr -c "cd ~/flockr && git pull && ~/.bun/bin/bun install"` and `systemctl restart flockr-runner`; logs with `journalctl -u flockr-runner -f`.
- The VPS takes SSH only over Tailscale (`ssh vps`; Tailscale asks for a browser approval now and then), with password login off. Its public sites (`shrillecho.app`, `ekron`, `leads-api`, `quickenrich`, `quickenrich-browser`) come in only through the Cloudflare Tunnel `simon-vps` (token `VPS_CLOUDFLARE_TUNNEL_TOKEN` in Infisical; routes set in the Cloudflare dashboard); ports 80 and 443 are dropped for outside traffic by `block-public-web.service`.
