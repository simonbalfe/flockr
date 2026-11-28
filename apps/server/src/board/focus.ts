import { partHeadline, planLimits, type ActivityEntry, type ActivityPart, type Focus, type FocusRun, type RunStep } from "@flockr/contracts"
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm"
import type { Executor } from "../db/client"
import { boardId } from "../config"
import { events, members, messages, tasks, type MessageRow, type TaskRow } from "../db/schema"
import { listPlans } from "./plans"
import { activityEntryOf, getInbox, presentTasks } from "./read"
import { visibleTo, type Viewer } from "./visibility"

const runningEntry = sql`${messages.activity}->>'status' = 'running'`

export const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

const runKey = (entry: ActivityEntry) => `${entry.who}|${entry.threadId}|${entry.runId ?? entry.id}`

const stepOf = (entry: ActivityEntry, part: ActivityPart): RunStep => ({
  kind: part.type,
  text: partHeadline(part),
  at: "startedAt" in part ? part.startedAt : entry.at,
})

const snippet = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text)

async function claimedByAgents(db: Executor, viewer: Viewer): Promise<TaskRow[]> {
  return db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(members, eq(members.name, tasks.holder))
    .where(and(eq(tasks.state, "claimed"), eq(members.kind, "agent"), visibleTo(tasks.channel, viewer)))
    .orderBy(asc(tasks.id))
    .then((rows) => rows.map((r) => r.task))
}

async function claimTimes(db: Executor, ids: number[]): Promise<Map<number, Date>> {
  if (!ids.length) return new Map()
  const rows = await db
    .select({ task: events.taskId, at: sql<Date>`max(${events.at})` })
    .from(events)
    .where(and(eq(events.boardId, boardId), inArray(events.taskId, ids), inArray(events.type, ["task.claimed", "task.handed_off"])))
    .groupBy(events.taskId)
  return new Map(rows.flatMap((r) => (r.task === null ? [] : [[r.task, new Date(r.at)]])))
}

async function runsInProgress(db: Executor, viewer: Viewer): Promise<FocusRun[]> {
  const running = (
    await db
      .select()
      .from(messages)
      .where(and(eq(messages.kind, "activity"), runningEntry, visibleTo(messages.channel, viewer)))
      .orderBy(asc(messages.id))
  ).flatMap((row) => activityEntryOf(row) ?? [])
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
  const claimed = await claimedByAgents(db, viewer)
  const runTaskIds = running.flatMap((e) => (/^\d+$/.test(e.threadId) ? [Number(e.threadId)] : []))
  const missingTaskIds = [...new Set(runTaskIds)].filter((id) => !claimed.some((t) => t.id === id))
  const rootIds = [...new Set(running.flatMap((e) => (/^m\d+$/.test(e.threadId) ? [Number(e.threadId.slice(1))] : [])))]
  const otherTasks = missingTaskIds.length ? await db.select().from(tasks).where(inArray(tasks.id, missingTaskIds)) : []
  const rootRows = rootIds.length ? await db.select().from(messages).where(inArray(messages.id, rootIds)) : []
  const claimedAt = await claimTimes(
    db,
    claimed.map((t) => t.id),
  )
  const taskById = new Map([...claimed, ...otherTasks].map((t) => [t.id, t]))
  const rootById = new Map(rootRows.map((r) => [r.id, r]))
  const groups = [...new Map(running.map((entry) => [runKey(entry), entry])).entries()].map(([key, entry]) => ({
    entry,
    group: (byRun.get(key) ?? [entry]).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
  }))
  const fromRun = ({ entry, group }: { entry: ActivityEntry; group: ActivityEntry[] }): FocusRun => {
    const steps = group.flatMap((e) => e.parts.map((part) => stepOf(e, part)))
    const task = /^\d+$/.test(entry.threadId) ? taskById.get(Number(entry.threadId)) : undefined
    const root = task ? undefined : rootById.get(Number(entry.threadId.slice(1)))
    return {
      agent: entry.who,
      channel: entry.channel,
      threadId: entry.threadId,
      taskId: task?.id ?? null,
      title: task?.title ?? (root && !root.deletedAt && root.body ? snippet(root.body) : entry.title),
      startedAt: group[0]?.at ?? entry.at,
      steps: steps.length,
      recent: steps.slice(-planLimits.recentSteps),
      leaseExpiresAt: task?.leaseExpiresAt?.toISOString() ?? null,
    }
  }
  const used = new Set<ActivityEntry>()
  const holding = claimed.flatMap((task): FocusRun[] => {
    if (task.holder === null) return []
    const mine = groups.filter((g) => g.entry.who === task.holder && g.entry.threadId === String(task.id))
    for (const g of mine) used.add(g.entry)
    const latest = mine.at(-1)
    if (latest) return [fromRun(latest)]
    return [
      {
        agent: task.holder,
        channel: task.channel,
        threadId: String(task.id),
        taskId: task.id,
        title: task.title,
        startedAt: (claimedAt.get(task.id) ?? task.updatedAt).toISOString(),
        steps: 0,
        recent: [],
        leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
      },
    ]
  })
  const others = groups.filter((g) => !used.has(g.entry)).map(fromRun)
  return [...holding, ...others].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

export async function getFocus(db: Executor, viewer: Viewer, now = new Date()): Promise<Focus> {
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
    plans: await listPlans(db, viewer, { state: "open" }),
    running: await runsInProgress(db, viewer),
    doneToday: await presentTasks(db, doneRows),
  }
}
