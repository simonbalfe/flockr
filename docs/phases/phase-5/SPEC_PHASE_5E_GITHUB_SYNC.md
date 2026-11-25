# 5e GitHub sync

Pull requests and their reviews and comments come into the task's thread (P51). Inbound only; posting back to GitHub waits for the GitHub App (PL7).

## Scope

- `POST /api/hooks/{host}`: a code host's webhook, signed with `FLOCKR_HOOK_SECRET` (16 characters or more). Off (404) until that secret is set.
- One code host interface (`apps/server/src/code-hosts/host.ts`) with the GitHub adapter first; adding a host is one adapter plus one entry in `codeHosts`.
- GitHub events: `pull_request` opened, reopened, closed, merged; `pull_request_review` submitted (approved, changes requested, or a review with text); `pull_request_review_comment` and `issue_comment` on a pull request.
- A pull request belongs to a task by its branch `flockr/<task>` (ADR 0019), or, for an issue comment that carries no branch, by an earlier `task.code_host` event for the same repo and number. The task's channel repo must equal the pull request's repo.
- Each event is a reply in the task's thread by the bridge member `github` (made on the first event), plus a `task.code_host` event. A merge also adds the merge commit to the task (3d).

Out: posting to GitHub, issues, pushes, check runs, a web screen to set the secret.

## Rules the tests hold (`apps/server/test/hooks.test.ts`)

- A delivery with a wrong signature is refused (401) and changes nothing.
- A delivery GitHub retries (same `X-GitHub-Delivery`) posts once.
- A pull request from another repo or a branch not named `flockr/<task>` changes nothing.
- A quoted `@claude` in a comment is not a mention: no agent wakes from GitHub text.

## Surfaces

The route is for code hosts, not members, so it is not an OpenAPI operation and has no MCP tool, `flockr` command or web control. What it posts shows on every surface as ordinary thread replies.

## Set up

1. `FLOCKR_HOOK_SECRET` in Infisical (`prod`) and as a Worker secret.
2. The channel's repo set (`github.com/<owner>/<name>`).
3. A repository webhook: payload URL `https://flockr.simonbalfe.com/api/hooks/github`, content type `application/json`, the same secret, events: pull requests, pull request reviews, pull request review comments, issue comments.

## Exit checklist

- [x] Route, adapter, deliveries table (`hook_deliveries`, migration 0013), tests
- [ ] A real webhook from a real repo once the board is deployed

## Notes from the build

- Delivery ids live in `hook_deliveries`; the board reset in tests truncates it too, or ids repeat across tests and read as duplicates.
- Replies are written with no mentions on purpose (Always: nothing acts unless asked).
