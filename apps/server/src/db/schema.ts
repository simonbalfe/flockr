import type { ActivityState, AgentDesired, AgentPermissions, AgentReport, HarnessInfo, MemberKind, Question, TaskState } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core"

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const messageSearchVector = (body: AnyPgColumn) => sql`to_tsvector('english', ${body})`
export const taskSearchVector = (title: AnyPgColumn, spec: AnyPgColumn) =>
  sql`(setweight(to_tsvector('english', ${title}), 'A') || setweight(to_tsvector('english', coalesce(${spec}, '')), 'B'))`

export const boards = pgTable("boards", {
  id: text("id").primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
})

export const members = pgTable(
  "members",
  {
    name: text("name").primaryKey(),
    kind: text("kind").$type<MemberKind>().notNull(),
    owner: text("owner").references((): AnyPgColumn => members.name),
    runsIn: text("runs_in"),
    source: text("source"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check("members_kind", sql`${t.kind} in ('person', 'agent', 'bridge', 'watcher')`)],
)

export const machines = pgTable("machines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  harnesses: jsonb("harnesses").$type<HarnessInfo[]>().notNull().default([]),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  announcedOnline: boolean("announced_online").notNull().default(false),
  createdAt: createdAt(),
})

export const agents = pgTable(
  "agents",
  {
    name: text("name")
      .primaryKey()
      .references(() => members.name),
    harness: text("harness").notNull(),
    folder: text("folder").notNull(),
    machine: text("machine")
      .notNull()
      .references(() => machines.id),
    permissions: text("permissions").$type<AgentPermissions>().notNull(),
    personality: text("personality"),
    model: text("model"),
    desired: text("desired").$type<AgentDesired>().notNull(),
    reported: text("reported").$type<AgentReport>(),
    reportedReason: text("reported_reason"),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("agents_permissions", sql`${t.permissions} in ('edit-free-commands-ask', 'read-only')`),
    check("agents_desired", sql`${t.desired} in ('running', 'stopped')`),
    check("agents_reported", sql`${t.reported} is null or ${t.reported} in ('serving', 'working', 'error')`),
    index("agents_machine").on(t.machine),
  ],
)

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull().default(""),
  createdAt: createdAt(),
})

export const tasks = pgTable(
  "tasks",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity({ startWith: 826, increment: 2 }),
    title: text("title").notNull(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    kind: text("kind").notNull().default("build"),
    state: text("state").$type<TaskState>().notNull(),
    needs: integer("needs").array().notNull().default(sql`'{}'::integer[]`),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    assignee: text("assignee").references(() => members.name),
    holder: text("holder").references(() => members.name),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    claimEpoch: integer("claim_epoch").notNull().default(0),
    spec: text("spec"),
    commit: text("commit"),
    reason: text("reason"),
    question: jsonb("question").$type<Question>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("tasks_state", sql`${t.state} in ('waiting', 'ready', 'claimed', 'blocked', 'review', 'done')`),
    index("tasks_ready").on(t.state, t.createdAt, t.id),
    index("tasks_channel").on(t.channel),
    index("tasks_search").using("gin", taskSearchVector(t.title, t.spec)),
  ],
)

export const messages = pgTable(
  "messages",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    kind: text("kind").$type<"text" | "task" | "ask" | "event" | "question" | "activity">().notNull(),
    who: text("who").notNull(),
    body: text("body").notNull().default(""),
    mentions: text("mentions").array().notNull().default(sql`'{}'::text[]`),
    question: jsonb("question").$type<Question>(),
    activity: jsonb("activity").$type<ActivityState>(),
    answer: text("answer"),
    answeredBy: text("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    system: boolean("system").notNull().default(false),
    taskId: integer("task_id").references(() => tasks.id),
    parentId: integer("parent_id").references((): AnyPgColumn => messages.id),
    threadTaskId: integer("thread_task_id").references(() => tasks.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check("messages_kind", sql`${t.kind} in ('text', 'task', 'ask', 'event', 'question', 'activity')`),
    check("messages_activity", sql`(${t.kind} = 'activity') = (${t.activity} is not null)`),
    check("messages_question", sql`(${t.kind} = 'question') = (${t.question} is not null)`),
    check("messages_one_thread", sql`${t.parentId} is null or ${t.threadTaskId} is null`),
    index("messages_feed").on(t.channel, t.id),
    index("messages_parent").on(t.parentId),
    index("messages_thread_task").on(t.threadTaskId),
    index("messages_search")
      .using("gin", messageSearchVector(t.body))
      .where(sql`${t.kind} = 'text' and ${t.deletedAt} is null`),
  ],
)

export const activity = pgTable(
  "activity",
  {
    member: text("member")
      .notNull()
      .references(() => members.name),
    threadId: text("thread_id").notNull(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.member, t.threadId] })],
)

export const reads = pgTable(
  "reads",
  {
    member: text("member")
      .notNull()
      .references(() => members.name),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    lastReadId: integer("last_read_id").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.member, t.channel] })],
)

export const events = pgTable(
  "events",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    channel: text("channel"),
    taskId: integer("task_id"),
    threadId: text("thread_id"),
    messageId: text("message_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.seq] })],
)

export type TaskRow = typeof tasks.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type MemberRow = typeof members.$inferSelect
export type ActivityRow = typeof activity.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type MachineRow = typeof machines.$inferSelect
