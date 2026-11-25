import { z } from "zod"
import { hmacSha256Hex, sameText, type CodeHost, type CodeHostEvent } from "./host"

// GitHub webhooks: pull requests, their reviews and comments. Point a repository or
// organisation webhook (content type application/json) at /api/hooks/github with the board's
// FLOCKR_HOOK_SECRET.

const User = z.object({ login: z.string() })
const Repository = z.object({ full_name: z.string() })
const PullRequest = z.object({
  number: z.number().int(),
  title: z.string(),
  html_url: z.string(),
  user: User,
  head: z.object({ ref: z.string() }),
  merged: z.boolean().nullish(),
  merge_commit_sha: z.string().nullish(),
})

const PullRequestPayload = z.object({ action: z.string(), pull_request: PullRequest, repository: Repository, sender: User })
const ReviewPayload = z.object({
  action: z.string(),
  review: z.object({ state: z.string(), body: z.string().nullish(), html_url: z.string(), user: User }),
  pull_request: PullRequest,
  repository: Repository,
})
const ReviewCommentPayload = z.object({
  action: z.string(),
  comment: z.object({ body: z.string(), html_url: z.string(), user: User }),
  pull_request: PullRequest,
  repository: Repository,
})
const IssueCommentPayload = z.object({
  action: z.string(),
  issue: z.object({ number: z.number().int(), title: z.string(), html_url: z.string(), pull_request: z.object({}).loose().nullish() }),
  comment: z.object({ body: z.string(), html_url: z.string(), user: User }),
  repository: Repository,
})

const repoOf = (repository: z.infer<typeof Repository>) => `github.com/${repository.full_name}`

function fromPullRequest(pr: z.infer<typeof PullRequest>, repository: z.infer<typeof Repository>) {
  return { repo: repoOf(repository), number: pr.number, title: pr.title, branch: pr.head.ref, mergeSha: null }
}

function parse(headers: Headers, body: string): CodeHostEvent | null {
  const json: unknown = JSON.parse(body)
  switch (headers.get("x-github-event")) {
    case "pull_request": {
      const p = PullRequestPayload.parse(json)
      const base = { ...fromPullRequest(p.pull_request, p.repository), url: p.pull_request.html_url, author: p.sender.login, body: null }
      if (p.action === "opened" || p.action === "reopened") return { ...base, kind: p.action }
      if (p.action === "closed") return p.pull_request.merged ? { ...base, kind: "merged", mergeSha: p.pull_request.merge_commit_sha ?? null } : { ...base, kind: "closed" }
      return null
    }
    case "pull_request_review": {
      const p = ReviewPayload.parse(json)
      if (p.action !== "submitted") return null
      const kind = p.review.state === "approved" ? "approved" : p.review.state === "changes_requested" ? "changes_requested" : "reviewed"
      if (kind === "reviewed" && !p.review.body) return null
      return { ...fromPullRequest(p.pull_request, p.repository), kind, url: p.review.html_url, author: p.review.user.login, body: p.review.body || null }
    }
    case "pull_request_review_comment": {
      const p = ReviewCommentPayload.parse(json)
      if (p.action !== "created") return null
      return { ...fromPullRequest(p.pull_request, p.repository), kind: "commented", url: p.comment.html_url, author: p.comment.user.login, body: p.comment.body }
    }
    case "issue_comment": {
      const p = IssueCommentPayload.parse(json)
      if (p.action !== "created" || !p.issue.pull_request) return null
      return { kind: "commented", repo: repoOf(p.repository), number: p.issue.number, title: p.issue.title, url: p.comment.html_url, author: p.comment.user.login, branch: null, body: p.comment.body, mergeSha: null }
    }
    default:
      return null
  }
}

export const github: CodeHost = {
  name: "github",
  memberName: "github",
  deliveryId: (headers) => headers.get("x-github-delivery"),
  async verify(headers, body, secret) {
    const given = headers.get("x-hub-signature-256") ?? ""
    return sameText(given, `sha256=${await hmacSha256Hex(secret, body)}`)
  },
  parse,
}
