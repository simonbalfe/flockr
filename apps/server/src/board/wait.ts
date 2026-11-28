import { waitLimits, type BoardEvent, type WaitQuery, type WaitResult } from "@flockr/contracts"
import { z } from "zod"
import type { Executor } from "../db/client"
import { eventsSince, headSeq } from "./events"
import { messageKey, parseThreadId, type ThreadRef } from "./read"
import type { Viewer } from "./visibility"

const threadKey = (ref: ThreadRef) => (ref.kind === "task" ? String(ref.id) : messageKey(ref.id))

const Mentions = z.object({ mentions: z.array(z.string()).catch([]) })

export interface WaitClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const realClock: WaitClock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

function matcher(viewer: Viewer, query: WaitQuery): (event: BoardEvent) => boolean {
  const thread = query.thread === undefined ? undefined : threadKey(parseThreadId(query.thread))
  return (event) =>
    event.actor !== viewer.member &&
    (thread === undefined || event.threadId === thread) &&
    (query.channel === undefined || event.channel === query.channel) &&
    (query.mentions === "no" || Mentions.parse(event.data).mentions.includes(viewer.member))
}

export async function waitForEvents(db: Executor, viewer: Viewer, query: WaitQuery, clock: WaitClock = realClock): Promise<WaitResult> {
  const matches = matcher(viewer, query)
  const deadline = clock.now() + query.timeout * 1000
  let cursor = query.since ?? (await headSeq(db))
  for (;;) {
    const head = await headSeq(db)
    const seen = await eventsSince(db, cursor, waitLimits.page, { kind: "member", viewer })
    const found = seen.filter(matches)
    const last = seen[seen.length - 1]?.seq ?? cursor
    cursor = seen.length < waitLimits.page ? Math.max(last, head) : last
    if (found.length) return { events: found, cursor: found[found.length - 1]?.seq ?? cursor, timedOut: false }
    if (seen.length === waitLimits.page) continue
    const left = deadline - clock.now()
    if (left <= 0) return { events: [], cursor, timedOut: true }
    await clock.sleep(Math.min(waitLimits.pollMs, left))
  }
}
