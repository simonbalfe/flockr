# Handoff: deploy and cloud agents, 25 Nov 2026

## Done

- Platform: PL1 live signals, PL2 Worker entry, PL3 board room Durable Object with hibernating sockets, PL9 platform boundary test, PL11 `docker compose up`, PL10 production Worker config (`env.production` in `apps/server/wrangler.jsonc`).
- Product: 1d sign-in (Better Auth magic links from an allowlist) and 3c agent keys, 1b message labels and edits, 2b review sub-threads, 3d commit links, 3e checklist import, 4a Herdr panes and agent pause, 4b agent activity, 5a watchers, 5b routines, 5c approval rules, 6a, 6b search, 6c morning brief. `bun run check` passes.
- ADRs 0017 (Cloudflare through platform adapters), 0018 (disposable Durable Objects), 0020 (jobs in Postgres), 0021 (sign-in); 0019 (coding agents) is still proposed.
- Ready for the deploy: `FLOCKR_PEOPLE` and `FLOCKR_AUTH_SECRET` are in Infisical; Email Routing is on for `simonbalfe.com` and the allowed address is a verified destination.

## Open

- **Neon database (blocks the deploy):** the Neon connector only reaches the Maestro organisation, so Simon creates a `flockr` project (Postgres 17, `aws-eu-west-2`) in his personal Neon account and stores the direct connection string as `FLOCKR_DATABASE_URL` in Infisical. While signed in there, delete CreatorCrawl's retired Neon project `creator-crawl` (`solitary-band-35983736`); its dumps are archived in R2 (`ohm/backups/creator-crawl/`, checksums verified).
- **Accounts:** 5d Slack sync and 5e GitHub sync need app credentials; 4c and 4d cloud agents need PL5 to PL8 (OpenRouter key exists in Infisical; spending on it needs Simon's yes) and a decision on ADR 0019.
- **Known gaps:** the first test run after a new migration once timed out on the shared test database and passed on rerun; the CLI help still prints `fc` while the skill says `flockr`; a phone run of Phase 2's done-when has not been done.

## Next: the deploy (PL4, PL10)

1. `sec run -- sh -c 'DATABASE_URL=$FLOCKR_DATABASE_URL bun run db:migrate'` to migrate Neon.
2. `wrangler hyperdrive create flockr-db --connection-string=...` in the personal account; put its id in `env.production.hyperdrive` and commit.
3. `wrangler secret put FLOCKR_PEOPLE --env production` and `FLOCKR_AUTH_SECRET`, piped from `sec get`.
4. `bun run build`, then `wrangler deploy --env production` from `apps/server`.
5. Check: sign in at `https://flockr.simonbalfe.com` with a magic link, post a message in two tabs, create an agent key and run `flockr whoami` with `FLOCKR_KEY`.
