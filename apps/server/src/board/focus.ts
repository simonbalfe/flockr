import { partHeadline, planLimits, type ActivityEntry, type ActivityPart, type Focus, type FocusRun, type RunStep } from "@flockr/contracts"
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm"
import type { Executor } from "../db/client"
import { messages, tasks, type MessageRow } from "../db/schema"
import { listPlans } from "./plans"
import { activityEntryOf, getInbox, presentTasks } from "./read"
import { visibleTo } from "./visibility"

const runningEntry = sql`${messages.activity}->>'status' = 'running'`

export const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

const runKey = (entry: ActivityEntry) => `${entry.who}|${entry.threadId}|${entry.runId ?? entry.id}`

const stepOf = (entry: ActivityEntry, part: ActivityPart): RunStep => ({
  kind: part.type,
  text: partHeadline(part),
  at: "startedAt" in part ? part.startedAt : entry.at,
})

const snippet = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text)

async function runsInProgress(db: Executor, viewer: string): Promise<FocusRun[]> {
  const running = (
    await db
      .select()
      .from(messages)
      .where(and(eq(messages.kind, "activity"), runningEntry, visibleTo(messages.channel, viewer)))
      .orderBy(asc(messages.id))
  ).flatMap((row) => activityEntryOf(row) ?? [])
  if (!running.length) return []
  const runIds = [...new Set(running.flatMap((e) => (e.runId === null ? [] : [e.runId])))]
  const siblings: MessageRow[] = runIds.length
    ? await db
        .select()
        .from(messages)
        .where(and(eq(messages.kind, "activity"), inArray(sql`${messages.activity}->>'runId'`, runIds)))
        .orderBy(asc(messages.id))
    : []
  const byRun = new Map<string, ActivityEntry[]>()
  for (const entry of [...siblings.flatMap((row) => activityEntryOf(row) ?? []), ...running]) {
    const key = runKey(entry)
    const list = byRun.get(key) ?? []
    if (!list.some((e) => e.id === entry.id)) list.push(entry)
    byRun.set(key, list)
  }
  const taskIds = [...new Set(running.flatMap((e) => (/^\d+$/.test(e.threadId) ? [Number(e.threadId)] : [])))]
  const rootIds = [...new Set(running.flatMap((e) => (/^m\d+$/.test(e.threadId) ? [Number(e.threadId.slice(1))] : [])))]
  const taskRows = taskIds.length ? await db.select().from(tasks).where(inArray(tasks.id, taskIds)) : []
  const rootRows = rootIds.length ? await db.select().from(messages).where(inArray(messages.id, rootIds)) : []
  const taskById = new Map(taskRows.map((t) => [t.id, t]))
  const rootById = new Map(rootRows.map((r) => [r.id, r]))
  const seen = new Set<string>()
  return running.flatMap((entry): FocusRun[] => {
    const key = runKey(entry)
    if (seen.has(key)) return []
    seen.add(key)
    const group = (byRun.get(key) ?? [entry]).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    const steps = group.flatMap((e) => e.parts.map((part) => stepOf(e, part)))
    const task = /^\d+$/.test(entry.threadId) ? taskById.get(Number(entry.threadId)) : undefined
    const root = task ? undefined : rootById.get(Number(entry.threadId.slice(1)))
    return [
      {
        agent: entry.who,
        channel: entry.channel,
        threadId: entry.threadId,
        taskId: task?.id ?? null,
        title: task?.title ?? (root && !root.deletedAt && root.body ? snippet(root.body) : entry.title),
        startedAt: group[0]?.at ?? entry.at,
        steps: steps.length,
        recent: steps.slice(-planLimits.recentSteps),
        leaseExpiresAt: task?.leaseExpiresAt?.toISOString() ?? null,
      },
    ]
  })
}

export async function getFocus(db: Executor, viewer: string, now = new Date()): Promise<Focus> {
  const inbox = await getInbox(db, viewer)
  const blockedRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.state, "blocked"), visibleTo(tasks.channel, viewer)))
    .orderBy(asc(tasks.updatedAt), asc(tasks.id))
  const doneRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.state, "done"), gte(tasks.updatedAt, startOfUtcDay(now)), visibleTo(tasks.channel, viewer)))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .limit(planLimits.focusDone)
  return {
    needsYou: { ...inbox, blocked: await presentTasks(db, blockedRows) },
    plans: await listPlans(db, { member: viewer, channels: null }, { state: "open" }),
    running: await runsInProgress(db, viewer),
    doneToday: await presentTasks(db, doneRows),
  }
}
