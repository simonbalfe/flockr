import { eq } from "drizzle-orm"
import { z } from "zod"
import { forbidden } from "../board/errors"
import { parseThreadId, type ThreadRef } from "../board/read"
import type { Database } from "../db/client"
import { messages, tasks } from "../db/schema"

type Target = { kind: "channel"; channel: string | null } | { kind: "thread"; ref: ThreadRef } | { kind: "open" } | { kind: "board" }

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

const rules: Rule[] = [
  { pattern: /^\/mcp$/, target: () => ({ kind: "open" }) },
  { method: "GET", pattern: /^\/api\/(me|members|channels)$/, target: () => ({ kind: "open" }) },
  { method: "POST", pattern: /^\/api\/tasks\/claim$/, target: () => ({ kind: "open" }) },
  { method: "GET", pattern: /^\/api\/(tasks|search)$/, target: (_, request) => ({ kind: "channel", channel: request.query.get("channel") }) },
  { method: "POST", pattern: /^\/api\/tasks$/, target: async (_, request) => ({ kind: "channel", channel: ChannelBody.safeParse(await request.body()).data?.channel ?? null }) },
  { pattern: /^\/api\/channels\/([^/]+)(\/.*)?$/, target: (match) => ({ kind: "channel", channel: segment(match) }) },
  { pattern: /^\/api\/tasks\/(\d+)(\/.*)?$/, target: (match) => ({ kind: "thread", ref: { kind: "task", id: Number(match[1]) } }) },
  { pattern: /^\/api\/(?:threads|messages|activity-entries)\/([^/]+)(\/.*)?$/, target: (match) => threadOf(segment(match)) },
]

async function channelOfThread(db: Database, ref: ThreadRef): Promise<string | null> {
  const [row] =
    ref.kind === "task"
      ? await db.select({ channel: tasks.channel }).from(tasks).where(eq(tasks.id, ref.id))
      : await db.select({ channel: messages.channel }).from(messages).where(eq(messages.id, ref.id))
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
    default: {
      const unhandled: never = target
      throw new Error(`Unhandled scope target ${JSON.stringify(unhandled)}`)
    }
  }
}
