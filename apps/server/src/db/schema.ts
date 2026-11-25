import type { ActionKind, ActivityState, AgentDesired, AgentPermissions, AgentReport, ApprovalVerdict, HarnessInfo, JobKind, JobState, MemberKind, Question, RoutineTriggerKind, TaskState } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core"

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
    check("agents_desired", sql`${t.desired} in ('running', 'paused', 'stopped')`),
    check("agents_reported", sql`${t.reported} is null or ${t.reported} in ('serving', 'working', 'error')`),
    index("agents_machine").on(t.machine),
  ],
)

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull().default(""),
  repo: text("repo"),
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

export const taskCommits = pgTable(
  "task_commits",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    sha: text("sha").notNull(),
    message: text("message"),
    addedBy: text("added_by").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("task_commits_task_sha").on(t.taskId, t.sha)],
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
    replyToId: integer("reply_to_id").references((): AnyPgColumn => messages.id),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    editedAt: timestamp("edited_at", { withTimezone: true }),
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

export const messageVersions = pgTable(
  "message_versions",
  {
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    mentions: text("mentions").array().notNull().default(sql`'{}'::text[]`),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.version] })],
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

export const routines = pgTable(
  "routines",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    triggerKind: text("trigger_kind").$type<RoutineTriggerKind>().notNull(),
    schedule: text("schedule"),
    eventType: text("event_type"),
    action: jsonb("action").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(false),
    perHour: integer("per_hour").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("routines_trigger", sql`(${t.triggerKind} = 'cron' and ${t.schedule} is not null and ${t.eventType} is null) or (${t.triggerKind} = 'event' and ${t.eventType} is not null and ${t.schedule} is null)`),
    check("routines_per_hour", sql`${t.perHour} > 0`),
    index("routines_watch").on(t.channel, t.eventType).where(sql`${t.enabled} and ${t.deletedAt} is null`),
    index("routines_due").on(t.nextRunAt).where(sql`${t.enabled} and ${t.deletedAt} is null`),
  ],
)

export const jobs = pgTable(
  "jobs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    kind: text("kind").$type<JobKind>().notNull(),
    key: text("key").notNull(),
    routineId: integer("routine_id").references(() => routines.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    state: text("state").$type<JobState>().notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    result: text("result"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("jobs_state", sql`${t.state} in ('queued', 'running', 'waiting', 'done', 'failed', 'skipped')`),
    uniqueIndex("jobs_key").on(t.key),
    index("jobs_due").on(t.runAt, t.id).where(sql`${t.state} = 'queued'`),
    index("jobs_stuck").on(t.lockedUntil).where(sql`${t.state} = 'running'`),
    index("jobs_routine").on(t.routineId, t.id),
    index("jobs_fired").on(t.finishedAt).where(sql`${t.state} = 'done'`),
  ],
)

export const approvalRules = pgTable(
  "approval_rules",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    kind: text("kind").$type<ActionKind>().notNull(),
    channel: text("channel").references(() => channels.id),
    verdict: text("verdict").$type<ApprovalVerdict>().notNull(),
    setBy: text("set_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("approval_rules_verdict", sql`${t.verdict} in ('allow', 'ask', 'block')`), unique("approval_rules_scope").on(t.kind, t.channel).nullsNotDistinct()],
)

export const jobApprovals = pgTable(
  "job_approvals",
  {
    jobId: integer("job_id")
      .primaryKey()
      .references(() => jobs.id),
    kind: text("kind").$type<ActionKind>().notNull(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    questionId: integer("question_id")
      .notNull()
      .references(() => messages.id),
    answer: text("answer"),
    answeredBy: text("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("job_approvals_question").on(t.questionId)],
)

export const memberKeys = pgTable(
  "member_keys",
  {
    id: text("id").primaryKey(),
    member: text("member")
      .notNull()
      .references(() => members.name),
    hash: text("hash").notNull(),
    shown: text("shown").notNull(),
    channels: text("channels").array(),
    createdBy: text("created_by")
      .notNull()
      .references(() => members.name),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("member_keys_hash").on(t.hash), index("member_keys_member").on(t.member)],
)

const authTimestamp = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow()

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: authTimestamp("created_at"),
  updatedAt: authTimestamp("updated_at"),
})

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: authTimestamp("created_at"),
    updatedAt: authTimestamp("updated_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_sessions_user").on(t.userId)],
)

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: authTimestamp("created_at"),
    updatedAt: authTimestamp("updated_at"),
  },
  (t) => [index("auth_accounts_user").on(t.userId)],
)

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: authTimestamp("created_at"),
    updatedAt: authTimestamp("updated_at"),
  },
  (t) => [index("auth_verifications_identifier").on(t.identifier)],
)

export type TaskRow = typeof tasks.$inferSelect
export type TaskCommitRow = typeof taskCommits.$inferSelect
export type ChannelRow = typeof channels.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type MessageVersionRow = typeof messageVersions.$inferSelect
export type MemberRow = typeof members.$inferSelect
export type ActivityRow = typeof activity.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type MachineRow = typeof machines.$inferSelect
export type RoutineRow = typeof routines.$inferSelect
export type JobRow = typeof jobs.$inferSelect
export type ApprovalRuleRow = typeof approvalRules.$inferSelect
export type JobApprovalRow = typeof jobApprovals.$inferSelect
export type MemberKeyRow = typeof memberKeys.$inferSelect

// Each code host delivery handled once, however often the host retries it (5e).
export const hookDeliveries = pgTable(
  "hook_deliveries",
  {
    host: text("host").notNull(),
    delivery: text("delivery").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.host, t.delivery] })],
)
