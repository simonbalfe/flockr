import { z } from "@hono/zod-openapi"
import { ActivityEntry, ApprovalAction } from "./activity"
import { AgentConfig, AgentStatusSchema, Machine } from "./agents"
import { agentStates, errorKinds, memberKinds, taskStates } from "./constants"

export const TaskState = z.enum(taskStates).openapi("TaskState")
export const MemberKind = z.enum(memberKinds).openapi("MemberKind")
export const AgentState = z.enum(agentStates).openapi("AgentState")

export const orNull = <T extends z.ZodType>(schema: T) => z.union([schema, z.null()])

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })

export const Channel = z
  .object({
    id: z.string().openapi({ example: "backend" }),
    topic: z.string(),
    unread: z.number().int().openapi({ description: "Feed items since the acting member last read the channel" }),
  })
  .openapi("Channel")

export const Member = z
  .object({
    name: z.string().openapi({ example: "reviewer" }),
    kind: MemberKind,
    owner: z.string().nullable().openapi({ description: "The person an agent acts for" }),
    runsIn: z.string().nullable(),
    source: z.string().nullable(),
  })
  .openapi("Member")

export const Question = z
  .object({
    text: z.string().openapi({ example: "Run the users migration on prod?" }),
    detail: z.string(),
    options: z.array(z.string()).min(2).openapi({ example: ["Run it", "Not now"] }),
    action: ApprovalAction.optional().openapi({ description: "The exact tool call being approved, when the question is a permission request" }),
  })
  .openapi("Question")

export const Task = z
  .object({
    id: z.number().int().openapi({ example: 806 }),
    title: z.string(),
    channel: z.string(),
    kind: z.string(),
    state: TaskState,
    needs: z.array(z.number().int()),
    labels: z.array(z.string()),
    assignee: z.string().nullable(),
    holder: z.string().nullable(),
    leaseExpiresAt: timestamp.nullable(),
    claimEpoch: z.number().int().openapi({ description: "Fence number, raised by every claim. Send it back on renew, complete and reply." }),
    spec: z.string().nullable(),
    commit: z.string().nullable(),
    reason: z.string().nullable(),
    question: orNull(Question),
    replyCount: z.number().int(),
    createdAt: timestamp,
  })
  .openapi("Task")

export const Agent = Member.extend({
  state: AgentState,
  taskId: z.number().int().nullable(),
  leaseExpiresAt: timestamp.nullable(),
  status: AgentStatusSchema,
  statusReason: z.string().nullable().openapi({ description: "Why the agent is offline or in error, in a few words" }),
  config: orNull(AgentConfig).openapi({ description: "How the agent is served; null for an agent that connects by itself" }),
}).openapi("Agent")

export const AgentDetail = Agent.extend({ tasks: z.array(Task) }).openapi("AgentDetail")

export const HeartbeatResult = z
  .object({ machine: Machine, agents: z.array(Agent).openapi({ description: "Every agent assigned to this machine" }) })
  .openapi("HeartbeatResult")

export const Reply = z
  .object({
    kind: z.literal("reply"),
    id: z.string(),
    who: z.string(),
    at: timestamp,
    text: z.string().openapi({ description: "Empty when the reply was deleted" }),
    deleted: z.boolean(),
    mentions: z.array(z.string()).openapi({ description: "Member names the text mentions with @name" }),
  })
  .openapi("Reply")

export const Event = z
  .object({ kind: z.literal("event"), id: z.string(), who: z.string(), at: timestamp, text: z.string(), system: z.boolean() })
  .openapi("Event")

export const ThreadQuestion = z
  .object({
    kind: z.literal("question"),
    id: z.string().openapi({ example: "m40", description: "The question's own message id" }),
    threadId: z.string().openapi({ description: "The thread it lives in: a message id such as m12 or a task id such as 806" }),
    channel: z.string(),
    who: z.string(),
    at: timestamp,
    question: Question,
    answer: z.string().nullable().openapi({ description: "The option picked, or null while the question is open" }),
    answeredBy: z.string().nullable(),
  })
  .openapi("ThreadQuestion")

export const ThreadEntry = z.discriminatedUnion("kind", [Reply, Event, ThreadQuestion, ActivityEntry]).openapi("ThreadEntry")

export const ThreadSummary = z
  .object({ count: z.number().int(), lastAt: timestamp, participants: z.array(z.string()) })
  .openapi("ThreadSummary")

export const TextMessage = z
  .object({
    kind: z.literal("text"),
    id: z.string().openapi({ example: "m12" }),
    channel: z.string(),
    who: z.string(),
    at: timestamp,
    text: z.string().openapi({ description: "Empty when the message was deleted" }),
    deleted: z.boolean(),
    mentions: z.array(z.string()).openapi({ description: "Member names the text mentions with @name" }),
    taskId: z.number().int().nullable(),
    threadId: z.string().nullable(),
    thread: orNull(ThreadSummary),
  })
  .openapi("TextMessage")

export const TaskMessage = z
  .object({ kind: z.literal("task"), id: z.string(), channel: z.string(), who: z.string(), at: timestamp, taskId: z.number().int() })
  .openapi("TaskMessage")

export const AskMessage = z
  .object({ kind: z.literal("ask"), id: z.string(), channel: z.string(), who: z.string(), at: timestamp, taskId: z.number().int() })
  .openapi("AskMessage")

export const FeedItem = z.discriminatedUnion("kind", [TextMessage, TaskMessage, AskMessage, Event]).openapi("FeedItem")

export const Thread = z
  .object({
    id: z.string().openapi({ description: "A message id such as m12, or a task id such as 806" }),
    channel: z.string(),
    taskId: z.number().int().nullable(),
    root: orNull(TextMessage),
    entries: z.array(ThreadEntry),
  })
  .openapi("Thread")

export const DeletedMessage = z
  .object({
    id: z.string().openapi({ example: "m12" }),
    channel: z.string(),
    deletedBy: z.string(),
    deletedAt: timestamp,
  })
  .openapi("DeletedMessage")

export const Inbox = z
  .object({
    questions: z.array(Task),
    threadQuestions: z.array(ThreadQuestion).openapi({ description: "Open questions asked in a thread rather than on a task" }),
    reviews: z.array(Task),
  })
  .openapi("Inbox")

export const Activity = z
  .object({
    member: z.string(),
    threadId: z.string(),
    channel: z.string(),
    since: timestamp,
    expiresAt: timestamp.openapi({ description: "Hide it after this time; the member refreshes it while it works" }),
  })
  .openapi("Activity")

export const BoardEvent = z
  .object({
    seq: z.number().int().openapi({ description: "Gapless per-board sequence number" }),
    type: z.string().openapi({ example: "task.claimed" }),
    at: timestamp,
    actor: z.string(),
    channel: z.string().nullable(),
    taskId: z.number().int().nullable(),
    threadId: z.string().nullable(),
    messageId: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
  })
  .openapi("BoardEvent")

export const EventPage = z
  .object({ events: z.array(BoardEvent), head: z.number().int().openapi({ description: "The latest sequence number on the board" }) })
  .openapi("EventPage")

export const ErrorBody = z.object({ error: z.string(), kind: z.enum(errorKinds) }).openapi("Error")

export type TaskState = z.infer<typeof TaskState>
export type MemberKind = z.infer<typeof MemberKind>
export type AgentState = z.infer<typeof AgentState>
export type Channel = z.infer<typeof Channel>
export type Member = z.infer<typeof Member>
export type Question = z.infer<typeof Question>
export type Task = z.infer<typeof Task>
export type Agent = z.infer<typeof Agent>
export type AgentDetail = z.infer<typeof AgentDetail>
export type HeartbeatResult = z.infer<typeof HeartbeatResult>
export type Reply = z.infer<typeof Reply>
export type Event = z.infer<typeof Event>
export type ThreadQuestion = z.infer<typeof ThreadQuestion>
export type ThreadEntry = z.infer<typeof ThreadEntry>
export type ThreadSummary = z.infer<typeof ThreadSummary>
export type TextMessage = z.infer<typeof TextMessage>
export type TaskMessage = z.infer<typeof TaskMessage>
export type AskMessage = z.infer<typeof AskMessage>
export type FeedItem = z.infer<typeof FeedItem>
export type Thread = z.infer<typeof Thread>
export type DeletedMessage = z.infer<typeof DeletedMessage>
export type Inbox = z.infer<typeof Inbox>
export type Activity = z.infer<typeof Activity>
export type BoardEvent = z.infer<typeof BoardEvent>
export type EventPage = z.infer<typeof EventPage>
