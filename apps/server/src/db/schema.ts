import { hostOrg } from "@flockr/contracts"
import type { ActionKind, ChannelKind, ChannelVisibility, DraftKind, AreaEndReason, ActivityState, AgentDesired, AgentPermissions, AgentReport, ApprovalVerdict, HarnessInfo, JobKind, JobState, MemberKind, MemoryKind, MemoryScope, Question, RoutineTriggerKind, TaskState } from "@flockr/contracts"
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

export const orgs = pgTable(
  "orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    host: boolean("host").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("orgs_one_host").on(t.host).where(sql`${t.host}`)],
)

export const members = pgTable(
  "members",
  {
    name: text("name").primaryKey(),
    kind: text("kind").$type<MemberKind>().notNull(),
    org: text("org")
      .notNull()
      .default(hostOrg)
      .references(() => orgs.id),
    owner: text("owner").references((): AnyPgColumn => members.name),
    runsIn: text("runs_in"),
    source: text("source"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check("members_kind", sql`${t.kind} in ('person', 'agent', 'bridge', 'watcher')`), index("members_org").on(t.org)],
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

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<ChannelKind>().notNull().default("channel"),
    org: text("org")
      .notNull()
      .default(hostOrg)
      .references(() => orgs.id),
    visibility: text("visibility").$type<ChannelVisibility>().notNull().default("org"),
    topic: text("topic").notNull().default(""),
    repo: text("repo"),
    createdAt: createdAt(),
  },
  (t) => [
    check("channels_kind", sql`${t.kind} in ('channel', 'dm')`),
    check("channels_visibility", sql`${t.visibility} in ('org', 'private', 'shared')`),
    index("channels_org").on(t.org),
  ],
)

export const channelMembers = pgTable(
  "channel_members",
  {
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    member: text("member")
      .notNull()
      .references(() => members.name),
    addedBy: text("added_by"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.member] }), index("channel_members_member").on(t.member)],
)

export const savedMessages = pgTable(
  "saved_messages",
  {
    member: text("member")
      .notNull()
      .references(() => members.name),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.member, t.messageId] })],
)

export const drafts = pgTable(
  "drafts",
  {
    member: text("member")
      .notNull()
      .references(() => members.name),
    kind: text("kind").$type<DraftKind>().notNull(),
    target: text("target").notNull(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    text: text("text").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.member, t.kind, t.target] }), check("drafts_kind", sql`${t.kind} in ('channel', 'thread')`)],
)

export const plans = pgTable(
  "plans",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    title: text("title").notNull(),
    goal: text("goal"),
    key: text("key"),
    createdBy: text("created_by")
      .notNull()
      .references(() => members.name),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("plans_key").on(t.channel, t.key).where(sql`${t.key} is not null`),
    index("plans_open").on(t.channel, t.id).where(sql`${t.closedAt} is null`),
  ],
)

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
    planId: integer("plan_id").references(() => plans.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("tasks_state", sql`${t.state} in ('waiting', 'ready', 'claimed', 'blocked', 'review', 'done')`),
    index("tasks_ready").on(t.state, t.createdAt, t.id),
    index("tasks_channel").on(t.channel),
    index("tasks_plan").on(t.planId),
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

// Files or folders a member says it is working in (8a). A row with a task lives while that task's claim does;
// a row with no task runs out at expires_at. Live means released_at is null and expires_at is null or ahead.
export const workingAreas = pgTable(
  "working_areas",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    owner: text("owner")
      .notNull()
      .references(() => members.name),
    taskId: integer("task_id").references(() => tasks.id),
    paths: text("paths").array().notNull(),
    note: text("note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedReason: text("released_reason").$type<AreaEndReason>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("working_areas_reason", sql`${t.releasedReason} is null or ${t.releasedReason} in ('released', 'task_ended', 'expired')`),
    index("working_areas_live").on(t.channel).where(sql`${t.releasedAt} is null`),
    uniqueIndex("working_areas_one_per_task").on(t.taskId).where(sql`${t.releasedAt} is null and ${t.taskId} is not null`),
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
    replyToId: integer("reply_to_id").references((): AnyPgColumn => messages.id),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    requestKey: text("request_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_request_key").on(t.who, t.requestKey).where(sql`${t.requestKey} is not null`),
    check("messages_kind", sql`${t.kind} in ('text', 'task', 'ask', 'event', 'question', 'activity')`),
    check("messages_activity", sql`(${t.kind} = 'activity') = (${t.activity} is not null)`),
    check("messages_question", sql`(${t.kind} = 'question') = (${t.question} is not null)`),
    check("messages_one_thread", sql`${t.parentId} is null or ${t.threadTaskId} is null`),
    index("messages_feed").on(t.channel, t.id),
    index("messages_parent").on(t.parentId),
    index("messages_who").on(t.who, t.id),
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

// Agent notes and channel memory: short items an agent or a channel keeps (ADR 0026). `owner` is the
// agent's name or the channel id by `scope`, checked when written, so one table holds both.
export const memoryItems = pgTable(
  "memory_items",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    scope: text("scope").$type<MemoryScope>().notNull(),
    owner: text("owner").notNull(),
    kind: text("kind").$type<MemoryKind>().notNull(),
    text: text("text").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sourceThread: text("source_thread"),
    key: text("key"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    check("memory_items_scope", sql`${t.scope} in ('agent', 'channel')`),
    check("memory_items_kind", sql`${t.kind} in ('dead-end', 'decision', 'preference', 'fact', 'todo')`),
    uniqueIndex("memory_items_key").on(t.scope, t.owner, t.key).where(sql`${t.key} is not null`),
    index("memory_items_owner").on(t.scope, t.owner, t.id),
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

export type OrgRow = typeof orgs.$inferSelect
export type ChannelMemberRow = typeof channelMembers.$inferSelect
export type TaskRow = typeof tasks.$inferSelect
export type PlanRow = typeof plans.$inferSelect
export type WorkingAreaRow = typeof workingAreas.$inferSelect
export type TaskCommitRow = typeof taskCommits.$inferSelect
export type ChannelRow = typeof channels.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type MessageVersionRow = typeof messageVersions.$inferSelect
export type MemberRow = typeof members.$inferSelect
export type ActivityRow = typeof activity.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type MachineRow = typeof machines.$inferSelect
export type RoutineRow = typeof routines.$inferSelect
export type MemoryItemRow = typeof memoryItems.$inferSelect
export type JobRow = typeof jobs.$inferSelect
export type ApprovalRuleRow = typeof approvalRules.$inferSelect
export type JobApprovalRow = typeof jobApprovals.$inferSelect
export type MemberKeyRow = typeof memberKeys.$inferSelect
export type DraftRow = typeof drafts.$inferSelect

export const hookDeliveries = pgTable(
  "hook_deliveries",
  {
    host: text("host").notNull(),
    delivery: text("delivery").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.host, t.delivery] })],
)

export interface StoredChunk {
  turn: number
  fence: string
  bytes: number
  sha256: string
  savedAt: string
}

export const sessionPointers = pgTable(
  "session_pointers",
  {
    agent: text("agent")
      .notNull()
      .references(() => members.name, { onDelete: "cascade" }),
    session: text("session").notNull(),
    thread: text("thread"),
    epoch: integer("epoch").notNull().default(0),
    fence: text("fence").notNull(),
    taskId: integer("task_id"),
    chunks: jsonb("chunks").$type<StoredChunk[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agent, t.session] }), index("session_pointers_thread").on(t.agent, t.thread, t.updatedAt)],
)

export type SessionPointerRow = typeof sessionPointers.$inferSelect
