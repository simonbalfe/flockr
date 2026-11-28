export const taskStates = ["waiting", "ready", "claimed", "blocked", "review", "done"] as const
export const memberKinds = ["person", "agent", "bridge", "watcher"] as const
export const agentStates = ["working", "blocked", "idle"] as const
export const channelKinds = ["channel", "dm"] as const
export const channelVisibilities = ["org", "private", "shared"] as const
export const hostOrg = "home"
export const yesNo = ["yes", "no"] as const
export const draftKinds = ["channel", "thread"] as const
export const navigationLimits = { threads: 50, sent: 50, saved: 100, draftChars: 20000, snippetChars: 140 } as const

export const livePath = "/ws"
export const memberHeader = "x-flockr-member"
export const authorizationHeader = "authorization"
export const bearerAuth = (key: string) => `Bearer ${key}`
export const defaultMember = "simon"
export const leaseMinutes = 15
export const activitySeconds = 120
export const messageLimits = { labels: 10, labelChars: 40 } as const
export const reviewLimits = { openPerReviewer: 2, inReviewPerHolder: 2 } as const

export const errorKinds = ["invalid", "unauthenticated", "not_member", "forbidden", "not_found", "already_exists", "wrong_state", "stale_claim", "not_holder", "lease_expired", "area_overlap", "stale_review", "review_full", "stale_version", "internal"] as const
export type ErrorKind = (typeof errorKinds)[number]

export const errorStatus = {
  invalid: 400,
  unauthenticated: 401,
  not_member: 403,
  forbidden: 403,
  not_found: 404,
  already_exists: 409,
  wrong_state: 409,
  stale_claim: 409,
  not_holder: 409,
  lease_expired: 409,
  area_overlap: 409,
  stale_review: 409,
  review_full: 409,
  stale_version: 409,
  internal: 500,
} as const satisfies Record<ErrorKind, number>

// What a code host webhook can tell a task thread (5e).
export const codeHostEventKinds = ["opened", "reopened", "closed", "merged", "commented", "approved", "changes_requested", "reviewed"] as const
export type CodeHostEventKind = (typeof codeHostEventKinds)[number]
