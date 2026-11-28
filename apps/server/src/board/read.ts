import {
  ActivityState,
  Blocks,
  commitUrl,
  shortSha,
  taskBranch,
  type ActivityEntry,
  type Channel,
  type ListMessagesQuery,
  type MessageVersions,
  type TaskCommit,
  Event,
  FeedItem,
  Inbox,
  ListTasksQuery,
  Member,
  Reply,
  Task,
  TextMessage,
  Thread,
  ThreadEntry,
  ThreadQuestion,
  ThreadSummary,
} from "@flockr/contracts"
import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import type { Executor } from "../db/client"
import { channels, members, messages, messageVersions, taskCommits, tasks, type MemberRow, type MessageRow, type TaskRow } from "../db/schema"
import { notFound } from "./errors"
import { listedMembersOf } from "./direct"
import { readableBy, seesMember, visibleTo, type Reader, type Viewer } from "./visibility"

export const messageKey = (id: number) => `m${id}`

export type ThreadRef = { kind: "message"; id: number } | { kind: "task"; id: number }

export function parseThreadId(raw: string): ThreadRef {
  const value = raw.trim().replace(/^#/, "")
  const message = /^m(\d+)$/.exec(value)
  if (message?.[1]) return { kind: "message", id: Number(message[1]) }
  if (/^\d+$/.test(value)) return { kind: "task", id: Number(value) }
  throw notFound(`Thread ${raw} does not exist; use a message id such as m12 or a task id such as 806`)
}

export function presentMember(row: MemberRow): Member {
  return { name: row.name, kind: row.kind, org: row.org, owner: row.owner, runsIn: row.runsIn, source: row.source }
}

async function replyCounts(db: Executor, ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map()
  const rows = await db
    .select({ id: messages.threadTaskId, count: sql<number>`count(*)::int` })
    .from(messages)
    .where(inArray(messages.threadTaskId, ids))
    .groupBy(messages.threadTaskId)
  return new Map(rows.map((r) => [r.id ?? 0, r.count]))
}

async function commitsByTask(db: Executor, ids: number[]): Promise<Map<number, TaskCommit[]>> {
  const grouped = new Map<number, TaskCommit[]>()
  if (!ids.length) return grouped
  const rows = await db
    .select({ commit: taskCommits, repo: channels.repo })
    .from(taskCommits)
    .innerJoin(tasks, eq(tasks.id, taskCommits.taskId))
    .innerJoin(channels, eq(channels.id, tasks.channel))
    .where(inArray(taskCommits.taskId, ids))
    .orderBy(asc(taskCommits.id))
  for (const { commit, repo } of rows) {
    const list = grouped.get(commit.taskId) ?? []
    list.push({
      sha: commit.sha,
      short: shortSha(commit.sha),
      message: commit.message,
      url: commitUrl(repo, commit.sha),
      addedBy: commit.addedBy,
      addedAt: commit.addedAt.toISOString(),
    })
    grouped.set(commit.taskId, list)
  }
  return grouped
}

function presentTaskRow(row: TaskRow, replyCount: number, commits: TaskCommit[]): Task {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel,
    kind: row.kind,
    state: row.state,
    needs: row.needs,
    labels: row.labels,
    assignee: row.assignee,
    holder: row.holder,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    claimEpoch: row.claimEpoch,
    spec: row.spec,
    branch: taskBranch(row.id),
    commits,
    reason: row.reason,
    question: row.question,
    replyCount,
    reviewer: row.reviewer,
    reviewCommit: row.reviewCommit,
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function presentTasks(db: Executor, rows: TaskRow[]): Promise<Task[]> {
  const ids = rows.map((r) => r.id)
  const [counts, commits] = await Promise.all([replyCounts(db, ids), commitsByTask(db, ids)])
  return rows.map((row) => presentTaskRow(row, counts.get(row.id) ?? 0, commits.get(row.id) ?? []))
}

export async function findTask(db: Executor, id: number): Promise<TaskRow> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id))
  if (!row) throw notFound(`Task #${id} does not exist`)
  return row
}

export async function getTask(db: Executor, id: number): Promise<Task> {
  const [task] = await presentTasks(db, [await findTask(db, id)])
  if (!task) throw notFound(`Task #${id} does not exist`)
  return task
}

export async function listTasks(db: Executor, query: ListTasksQuery, viewer: Viewer): Promise<Task[]> {
  const filters: SQL[] = [visibleTo(tasks.channel, viewer)]
  if (query.channel) filters.push(eq(tasks.channel, query.channel))
  if (query.state) filters.push(eq(tasks.state, query.state))
  if (query.assignee) filters.push(eq(tasks.assignee, query.assignee))
  if (query.reviewer) filters.push(eq(tasks.reviewer, query.reviewer))
  if (query.member) {
    const involved = or(eq(tasks.assignee, query.member), eq(tasks.holder, query.member))
    if (involved) filters.push(involved)
  }
  const rows = await db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(asc(tasks.id))
  return presentTasks(db, rows)
}

export async function listMembers(db: Executor, viewer: Viewer): Promise<Member[]> {
  const rows = await db
    .select()
    .from(members)
    .where(and(isNull(members.removedAt), seesMember(members.name, viewer))).orderBy(asc(members.createdAt), asc(members.name))
  return rows.map(presentMember)
}

export async function findMember(db: Executor, name: string): Promise<MemberRow | undefined> {
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(members.name, name), isNull(members.removedAt)))
  return row
}

export async function findAnyMember(db: Executor, name: string): Promise<MemberRow | undefined> {
  const [row] = await db.select().from(members).where(eq(members.name, name))
  return row
}

export async function listChannels(db: Executor, viewer: Viewer): Promise<Channel[]> {
  const member = viewer.member
  const rows = await db
    .select({
      id: channels.id,
      kind: channels.kind,
      org: channels.org,
      visibility: channels.visibility,
      topic: channels.topic,
      repo: channels.repo,
      reviewNeedsPerson: channels.reviewNeedsPerson,
      unread: sql<number>`(
        select count(*)::int from messages m
        where m.channel = "channels"."id" and m.parent_id is null and m.thread_task_id is null and m.who <> ${member}
          and m.id > coalesce((select r.last_read_id from reads r where r.member = ${member} and r.channel = "channels"."id"), 0)
      )`,
    })
    .from(channels)
    .where(visibleTo(channels.id, viewer))
    .orderBy(asc(channels.createdAt), asc(channels.id))
  const people = await listedMembersOf(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((row) => ({ ...row, members: people.get(row.id) ?? [] }))
}

export async function requireChannel(db: Executor, id: string): Promise<void> {
  const [row] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, id))
  if (!row) throw notFound(`Channel ${id} does not exist`)
}

export const threadKeyOf = (row: MessageRow): string =>
  row.threadTaskId !== null ? String(row.threadTaskId) : messageKey(row.parentId ?? row.id)

export function questionOf(row: MessageRow): ThreadQuestion | null {
  if (row.kind !== "question" || !row.question) return null
  return {
    kind: "question",
    id: messageKey(row.id),
    threadId: threadKeyOf(row),
    channel: row.channel,
    who: row.who,
    at: row.createdAt.toISOString(),
    question: row.question,
    answer: row.answer,
    answeredBy: row.answeredBy,
  }
}

export function activityEntryOf(row: MessageRow): ActivityEntry | null {
  if (row.kind !== "activity" || !row.activity) return null
  const { key: _key, ...state } = ActivityState.parse(row.activity)
  return { ...state, kind: "activity", id: messageKey(row.id), threadId: threadKeyOf(row), channel: row.channel, who: row.who, at: row.createdAt.toISOString() }
}

function entryOf(row: MessageRow): ThreadEntry {
  if (row.kind === "event") return eventOf(row)
  const activity = activityEntryOf(row)
  if (activity) return activity
  const question = questionOf(row)
  if (question) return question
  const reply: Reply = {
    kind: "reply",
    id: messageKey(row.id),
    who: row.who,
    at: row.createdAt.toISOString(),
    text: row.deletedAt ? "" : row.body,
    deleted: row.deletedAt !== null,
    mentions: row.deletedAt ? [] : row.mentions,
    labels: row.labels,
    editedAt: row.editedAt?.toISOString() ?? null,
    replyTo: row.replyToId === null ? null : messageKey(row.replyToId),
    blocks: row.deletedAt ? [] : Blocks.parse(row.blocks),
  }
  return reply
}

export const replyOf = (row: MessageRow): Reply => {
  const entry = entryOf(row)
  if (entry.kind !== "reply") throw new Error(`${messageKey(row.id)} is not a reply`)
  return entry
}

function eventOf(row: MessageRow): Event {
  return { kind: "event", id: messageKey(row.id), who: row.who, at: row.createdAt.toISOString(), text: row.body, system: row.system, blocks: Blocks.parse(row.blocks) }
}

function summarize(replies: MessageRow[], known: Set<string>): ThreadSummary | null {
  const talk = replies.filter((r) => r.kind !== "activity")
  const last = talk[talk.length - 1]
  if (!last) return null
  const participants = [...new Set(talk.map((r) => r.who).filter((w) => known.has(w)))].slice(0, 3)
  return { count: talk.length, lastAt: last.createdAt.toISOString(), participants }
}

function textOf(row: MessageRow, replies: MessageRow[], known: Set<string>): TextMessage {
  return {
    kind: "text",
    id: messageKey(row.id),
    channel: row.channel,
    who: row.who,
    at: row.createdAt.toISOString(),
    text: row.deletedAt ? "" : row.body,
    deleted: row.deletedAt !== null,
    mentions: row.deletedAt ? [] : row.mentions,
    labels: row.labels,
    editedAt: row.editedAt?.toISOString() ?? null,
    taskId: row.taskId,
    threadId: row.taskId === null ? messageKey(row.id) : null,
    blocks: row.deletedAt ? [] : Blocks.parse(row.blocks),
    thread: summarize(replies, known),
  }
}

async function knownNames(db: Executor): Promise<Set<string>> {
  const rows = await db.select({ name: members.name }).from(members)
  return new Set(rows.map((r) => r.name))
}

async function repliesByParent(db: Executor, ids: number[]): Promise<Map<number, MessageRow[]>> {
  const grouped = new Map<number, MessageRow[]>()
  if (!ids.length) return grouped
  const rows = await db.select().from(messages).where(inArray(messages.parentId, ids)).orderBy(asc(messages.id))
  for (const row of rows) {
    const list = grouped.get(row.parentId ?? 0) ?? []
    list.push(row)
    grouped.set(row.parentId ?? 0, list)
  }
  return grouped
}

function labelFilter(label: string | undefined): SQL | undefined {
  if (label === undefined) return undefined
  return or(
    sql`${label} = any(${messages.labels})`,
    and(inArray(messages.kind, ["task", "ask"]), sql`exists (select 1 from tasks t where t.id = ${messages.taskId} and ${label} = any(t.labels))`),
  )
}

export async function listFeed(db: Executor, channel: string, query: ListMessagesQuery = {}): Promise<FeedItem[]> {
  await requireChannel(db, channel)
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.channel, channel), isNull(messages.parentId), isNull(messages.threadTaskId), labelFilter(query.label)))
    .orderBy(asc(messages.id))
  const replies = await repliesByParent(
    db,
    rows.filter((r) => r.kind === "text").map((r) => r.id),
  )
  const known = await knownNames(db)
  return rows.map((row): FeedItem => {
    const base = { id: messageKey(row.id), channel: row.channel, who: row.who, at: row.createdAt.toISOString() }
    switch (row.kind) {
      case "event":
        return eventOf(row)
      case "task":
        return { ...base, kind: "task", taskId: row.taskId ?? 0 }
      case "ask":
        return { ...base, kind: "ask", taskId: row.taskId ?? 0 }
      case "text":
        return textOf(row, replies.get(row.id) ?? [], known)
      case "question":
      case "activity":
        throw new Error(`${row.kind} ${messageKey(row.id)} has no thread`)
    }
  })
}

export async function findMessage(db: Executor, id: number): Promise<MessageRow> {
  const [row] = await db.select().from(messages).where(eq(messages.id, id))
  if (!row) throw notFound(`Message ${messageKey(id)} does not exist`)
  return row
}

export async function findMessageForUpdate(db: Executor, id: number): Promise<MessageRow> {
  const [row] = await db.select().from(messages).where(eq(messages.id, id)).for("update")
  if (!row) throw notFound(`Message ${messageKey(id)} does not exist`)
  return row
}

export async function getThread(db: Executor, raw: string): Promise<Thread> {
  const ref = parseThreadId(raw)
  if (ref.kind === "task") {
    const task = await findTask(db, ref.id)
    const entries = await db.select().from(messages).where(eq(messages.threadTaskId, ref.id)).orderBy(asc(messages.id))
    return { id: String(ref.id), channel: task.channel, taskId: ref.id, root: null, entries: entries.map(entryOf) }
  }
  const root = await findMessage(db, ref.id)
  const entries = (await repliesByParent(db, [root.id])).get(root.id) ?? []
  const known = await knownNames(db)
  return {
    id: messageKey(root.id),
    channel: root.channel,
    taskId: null,
    root: root.kind === "text" ? textOf(root, entries, known) : null,
    entries: entries.map(entryOf),
  }
}

export async function getMessageVersions(db: Executor, raw: string): Promise<MessageVersions> {
  const ref = parseThreadId(raw)
  if (ref.kind === "task") throw notFound(`${raw} is a task; versions belong to messages such as m12`)
  const row = await findMessage(db, ref.id)
  const id = messageKey(row.id)
  if (row.deletedAt) return { id, deleted: true, versions: [] }
  const earlier = await db.select().from(messageVersions).where(eq(messageVersions.messageId, row.id)).orderBy(asc(messageVersions.version))
  return {
    id,
    deleted: false,
    versions: [
      ...earlier.map((v) => ({ version: v.version, text: v.body, mentions: v.mentions, at: v.writtenAt.toISOString(), current: false })),
      { version: earlier.length + 1, text: row.body, mentions: row.mentions, at: (row.editedAt ?? row.createdAt).toISOString(), current: true },
    ],
  }
}

export async function getInbox(db: Executor, reader: Reader): Promise<Inbox> {
  const questionRows = await db
    .select()
    .from(tasks)
    .where(and(isNotNull(tasks.question), eq(tasks.state, "claimed"), readableBy(tasks.channel, reader)))
    .orderBy(asc(tasks.id))
  const reviewRows = await db.select().from(tasks).where(and(eq(tasks.state, "review"), readableBy(tasks.channel, reader))).orderBy(asc(tasks.id))
  const asked = await db
    .select()
    .from(messages)
    .where(and(eq(messages.kind, "question"), isNull(messages.answer), isNull(messages.deletedAt), readableBy(messages.channel, reader)))
    .orderBy(asc(messages.id))
  return {
    questions: await presentTasks(db, questionRows),
    threadQuestions: asked.flatMap((row) => questionOf(row) ?? []),
    reviews: await presentTasks(db, reviewRows),
  }
}
