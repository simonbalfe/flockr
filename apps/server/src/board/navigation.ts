import { navigationLimits, type MyThread, type SentItem } from "@flockr/contracts"
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm"
import type { Executor } from "../db/client"
import { messages, tasks, type MessageRow } from "../db/schema"
import { messageKey, threadKeyOf } from "./read"
import { visibleTo } from "./visibility"

const candidateThreads = 200
const ownScanLimit = 2000

const snippet = (text: string) => (text.length > navigationLimits.snippetChars ? `${text.slice(0, navigationLimits.snippetChars - 1)}...` : text)
const isReply = (row: MessageRow) => row.parentId !== null || row.threadTaskId !== null
const alive = (viewer: string) => and(eq(messages.kind, "text"), isNull(messages.deletedAt), visibleTo(messages.channel, viewer))

export async function listMyThreads(db: Executor, actor: string): Promise<MyThread[]> {
  const mine = await db
    .select()
    .from(messages)
    .where(and(eq(messages.who, actor), alive(actor)))
    .orderBy(desc(messages.id))
    .limit(ownScanLimit)
  const rootIds = mine.filter((row) => !isReply(row)).map((row) => row.id)
  const answered = rootIds.length ? await db.selectDistinct({ id: messages.parentId }).from(messages).where(and(inArray(messages.parentId, rootIds), alive(actor))) : []
  const rootsWithReplies = new Set(answered.map((r) => r.id))
  const lastOwn = new Map<string, number>()
  for (const row of mine) {
    if (!isReply(row) && !rootsWithReplies.has(row.id)) continue
    const key = threadKeyOf(row)
    lastOwn.set(key, Math.max(lastOwn.get(key) ?? 0, row.id))
  }
  const keys = [...lastOwn.entries()].sort((a, b) => b[1] - a[1]).slice(0, candidateThreads)
  if (!keys.length) return []
  const threadRoots = keys.flatMap(([key]) => (key.startsWith("m") ? [Number(key.slice(1))] : []))
  const threadTasks = keys.flatMap(([key]) => (key.startsWith("m") ? [] : [Number(key)]))
  const entries = await db
    .select()
    .from(messages)
    .where(and(alive(actor), or(threadRoots.length ? inArray(messages.parentId, threadRoots) : undefined, threadTasks.length ? inArray(messages.threadTaskId, threadTasks) : undefined)))
    .orderBy(messages.id)
  const roots = threadRoots.length ? await db.select().from(messages).where(inArray(messages.id, threadRoots)) : []
  const taskRows = threadTasks.length ? await db.select().from(tasks).where(inArray(tasks.id, threadTasks)) : []
  const rootById = new Map(roots.map((r) => [r.id, r]))
  const taskById = new Map(taskRows.map((t) => [t.id, t]))
  const byThread = new Map<string, MessageRow[]>()
  for (const entry of entries) byThread.set(threadKeyOf(entry), [...(byThread.get(threadKeyOf(entry)) ?? []), entry])
  const threads = keys.flatMap(([key, own]): MyThread[] => {
    const replies = byThread.get(key) ?? []
    const last = replies.at(-1)
    if (!last) return []
    const root = key.startsWith("m") ? rootById.get(Number(key.slice(1))) : undefined
    const task = key.startsWith("m") ? undefined : taskById.get(Number(key))
    const title = root ? root.body : (task?.title ?? "")
    return [
      {
        threadId: key,
        channel: last.channel,
        taskId: task?.id ?? null,
        title: snippet(root?.deletedAt ? "" : title),
        startedBy: root?.who ?? task?.assignee ?? replies[0]?.who ?? actor,
        replies: replies.length,
        lastAt: last.createdAt.toISOString(),
        lastWho: last.who,
        lastText: snippet(last.body),
        unread: replies.filter((r) => r.who !== actor && r.id > own).length,
      },
    ]
  })
  return threads.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || b.threadId.localeCompare(a.threadId)).slice(0, navigationLimits.threads)
}

export async function listSent(db: Executor, actor: string): Promise<SentItem[]> {
  const rows = await db.select().from(messages).where(and(eq(messages.who, actor), alive(actor))).orderBy(desc(messages.id)).limit(navigationLimits.sent)
  return rows.map((row) => ({
    id: messageKey(row.id),
    kind: isReply(row) ? "reply" : "message",
    channel: row.channel,
    threadId: threadKeyOf(row),
    taskId: row.threadTaskId ?? row.taskId,
    at: row.createdAt.toISOString(),
    text: row.body,
  }))
}
