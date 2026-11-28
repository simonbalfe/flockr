import { eq } from "drizzle-orm"
import { z } from "zod"
import { forbidden } from "../board/errors"
import { parseThreadId, type ThreadRef } from "../board/read"
import type { Database } from "../db/client"
import { messages, plans, tasks } from "../db/schema"
import { isHostMember, requireSees, type Viewer } from "../board/visibility"
import { channelOfFile } from "../board/attachments"

type Target = { kind: "channel"; channel: string | null } | { kind: "thread"; ref: ThreadRef } | { kind: "plan"; id: number } | { kind: "file"; id: string } | { kind: "open" } | { kind: "viewer" } | { kind: "board" }

interface ScopedRequest {
  method: string
  pathname: string
  query: URLSearchParams
  body: () => Promise<unknown>
}

interface Rule {
  method?: string
  pattern: RegExp
  target: (match: RegExpExecArray, request: ScopedRequest) => Promise<Target> | Target
}

const ChannelBody = z.object({ channel: z.string() })
const segment = (match: RegExpExecArray) => decodeURIComponent(match[1] ?? "")
const threadOf = (raw: string): Target => {
  try {
    return { kind: "thread", ref: parseThreadId(raw) }
  } catch {
    return { kind: "open" }
  }
}

function waitTarget(query: URLSearchParams): Target {
  const thread = query.get("thread")
  if (thread) return threadOf(thread)
  const channel = query.get("channel")
  return channel ? { kind: "channel", channel } : { kind: "open" }
}

const rules: Rule[] = [
  { pattern: /^\/mcp$/, target: () => ({ kind: "open" }) },
  { method: "PATCH", pattern: /^\/api\/members\/[^/]+\/profile$/, target: () => ({ kind: "open" }) },
  { method: "GET", pattern: /^\/api\/(me|members|channels)$/, target: () => ({ kind: "open" }) },
  { method: "GET", pattern: /^\/api\/plans$/, target: () => ({ kind: "open" }) },
  { method: "POST", pattern: /^\/api\/plans$/, target: async (_, request) => ({ kind: "channel", channel: ChannelBody.safeParse(await request.body()).data?.channel ?? null }) },
  { pattern: /^\/api\/plans\/(\d+)(\/.*)?$/, target: (match) => ({ kind: "plan", id: Number(match[1]) }) },
  { pattern: /^\/api\/files\/(f\d+)(\/.*)?$/, target: (match) => ({ kind: "file", id: match[1] ?? "" }) },
  { method: "POST", pattern: /^\/api\/tasks\/claim$/, target: () => ({ kind: "open" }) },
  { method: "GET", pattern: /^\/api\/(tasks|search)$/, target: (_, request) => ({ kind: "channel", channel: request.query.get("channel") }) },
  { method: "POST", pattern: /^\/api\/tasks$/, target: async (_, request) => ({ kind: "channel", channel: ChannelBody.safeParse(await request.body()).data?.channel ?? null }) },
  { pattern: /^\/api\/channels\/([^/]+)(\/.*)?$/, target: (match) => ({ kind: "channel", channel: segment(match) }) },
  { pattern: /^\/api\/tasks\/(\d+)(\/.*)?$/, target: (match) => ({ kind: "thread", ref: { kind: "task", id: Number(match[1]) } }) },
  { pattern: /^\/api\/(?:threads|messages|activity-entries)\/([^/]+)(\/.*)?$/, target: (match) => threadOf(segment(match)) },
  { method: "GET", pattern: /^\/api\/(events|focus|inbox|activity)$/, target: () => ({ kind: "viewer" }) },
  { pattern: /^\/api\/me\/[a-z]+$/, target: () => ({ kind: "viewer" }) },
  { method: "POST", pattern: /^\/api\/(dms|members)$/, target: () => ({ kind: "viewer" }) },
  { method: "GET", pattern: /^\/api\/orgs$/, target: () => ({ kind: "open" }) },
  { method: "GET", pattern: /^\/api\/wait$/, target: (_, request) => waitTarget(request.query) },
]

async function channelOfThread(db: Database, ref: ThreadRef): Promise<string | null> {
  const [row] =
    ref.kind === "task"
      ? await db.select({ channel: tasks.channel }).from(tasks).where(eq(tasks.id, ref.id))
      : await db.select({ channel: messages.channel }).from(messages).where(eq(messages.id, ref.id))
  return row?.channel ?? null
}

async function channelOfPlan(db: Database, id: number): Promise<string | null> {
  const [row] = await db.select({ channel: plans.channel }).from(plans).where(eq(plans.id, id))
  return row?.channel ?? null
}

async function targetOf(request: ScopedRequest): Promise<Target> {
  for (const rule of rules) {
    if (rule.method && rule.method !== request.method) continue
    const match = rule.pattern.exec(request.pathname)
    if (match) return rule.target(match, request)
  }
  return { kind: "board" }
}

export async function requireInScope(db: Database, limit: string[] | null, request: ScopedRequest): Promise<void> {
  if (limit === null) return
  const target = await targetOf(request)
  const refuse = () => forbidden(`This key is limited to ${limit.map((c) => `#${c}`).join(", ")}; it cannot do this`)
  switch (target.kind) {
    case "open":
      return
    case "viewer":
    case "board":
      throw refuse()
    case "channel":
      if (target.channel === null || !limit.includes(target.channel)) throw refuse()
      return
    case "thread": {
      const channel = await channelOfThread(db, target.ref)
      if (channel !== null && !limit.includes(channel)) throw refuse()
      return
    }
    case "plan": {
      const channel = await channelOfPlan(db, target.id)
      if (channel !== null && !limit.includes(channel)) throw refuse()
      return
    }
    case "file": {
      const channel = await channelOfFile(db, target.id)
      if (channel !== null && !limit.includes(channel)) throw refuse()
      return
    }
    default: {
      const unhandled: never = target
      throw new Error(`Unhandled scope target ${JSON.stringify(unhandled)}`)
    }
  }
}

export async function requireReach(db: Database, viewer: Viewer, request: ScopedRequest): Promise<void> {
  const target = await targetOf(request)
  switch (target.kind) {
    case "channel":
      return requireSees(db, viewer, target.channel)
    case "thread":
      return requireSees(db, viewer, await channelOfThread(db, target.ref))
    case "plan":
      return requireSees(db, viewer, await channelOfPlan(db, target.id))
    case "file":
      return requireSees(db, viewer, await channelOfFile(db, target.id))
    case "open":
    case "viewer":
      return
    case "board":
      if (await isHostMember(db, viewer)) return
      throw forbidden(`${viewer.member} is in a client org; only the org that runs the board can do this`)
    default: {
      const unhandled: never = target
      throw new Error(`Unhandled scope target ${JSON.stringify(unhandled)}`)
    }
  }
}
