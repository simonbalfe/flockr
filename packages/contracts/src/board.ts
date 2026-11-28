import { z } from "@hono/zod-openapi"
import { ActivityEntry, ApprovalAction } from "./activity"
import { AgentConfig, AgentStatusSchema, Machine } from "./agents"
import { agentStates, channelKinds, errorKinds, memberKinds, messageLimits, taskStates } from "./constants"
import { ChannelVisibility } from "./orgs"
import { profileColours } from "./invites"
import { Block } from "./blocks"
import { FileRef, Reaction } from "./attachments"

export const TaskState = z.enum(taskStates).openapi("TaskState")
export const MemberKind = z.enum(memberKinds).openapi("MemberKind")
export const AgentState = z.enum(agentStates).openapi("AgentState")

export const orNull = <T extends z.ZodType>(schema: T) => z.union([schema, z.null()])

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })

export const Label = z
  .string()
  .trim()
  .min(1)
  .max(messageLimits.labelChars)
  .regex(/^[^\s,]+$/, "A label has no spaces or commas")
  .openapi("Label", { example: "review" })
export const Labels = z.array(Label).max(messageLimits.labels)

const editedAt = timestamp.nullable().openapi({ description: "When the text was last edited; null when never. Earlier versions: listMessageVersions" })
const messageLabels = z.array(z.string()).openapi({ description: "Labels on the message, in the order they were added" })

export const ChannelKind = z.enum(channelKinds).openapi("ChannelKind")

export const Channel = z
  .object({
    id: z.string().openapi({ example: "backend" }),
    kind: ChannelKind.openapi({ description: "channel is a room; dm is a private conversation between its two members" }),
    org: z.string().openapi({ example: "home", description: "The org that owns the channel" }),
    visibility: ChannelVisibility,
    members: z.array(z.string()).openapi({ description: "The listed members: the two of a dm, or those added to a private or shared channel (listChannelMembers); everyone in the owning org also sees an org or shared channel", example: ["simon", "claude"] }),
    topic: z.string(),
    repo: z.string().nullable().openapi({ example: "github.com/simonbalfe/flockr", description: "Where the channel's code lives; null when none is set" }),
    reviewNeedsPerson: z.boolean().openapi({ description: "When true only a person approves a task here; a named reviewer agent may still ask for changes" }),
    unread: z.number().int().openapi({ description: "Feed items since the acting member last read the channel" }),
  })
  .openapi("Channel")

export const Member = z
  .object({
    name: z.string().openapi({ example: "reviewer" }),
    kind: MemberKind,
    org: z.string().openapi({ example: "home", description: "The org the member belongs to" }),
    owner: z.string().nullable().openapi({ description: "The person an agent acts for" }),
    runsIn: z.string().nullable(),
    source: z.string().nullable(),
    displayName: z.string().nullable().openapi({ example: "Ana from Acme", description: "Shown with the member name; null shows the name alone" }),
    about: z.string().nullable(),
    colour: z.enum(profileColours).nullable(),
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

export const TaskCommit = z
  .object({
    sha: z.string().openapi({ example: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" }),
    short: z.string().openapi({ example: "a1b2c3d" }),
    message: z.string().nullable(),
    url: z.string().nullable().openapi({ example: "https://github.com/simonbalfe/flockr/commit/a1b2c3d", description: "Built from the channel's repo; null when the channel has none" }),
    addedBy: z.string(),
    addedAt: timestamp,
  })
  .openapi("TaskCommit")

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
    branch: z.string().openapi({ example: "flockr/806", description: "Where this task's work goes: flockr/<id>. Merged only after review" }),
    commits: z.array(TaskCommit).openapi({ description: "The commits that did this task, oldest first" }),
    reviewer: z.string().nullable().openapi({ example: "codex", description: "The member asked to review it; with a reviewer named the task reaches done only by approval" }),
    reviewCommit: z.string().nullable().openapi({ example: "a1b2c3d", description: "The commit the task is in review at; an approval naming an older one is refused (stale_review)" }),
    reason: z.string().nullable(),
    question: orNull(Question),
    replyCount: z.number().int(),
    planId: z.number().int().nullable().openapi({ description: "The plan this task belongs to, or null" }),
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
    labels: messageLabels,
    editedAt,
    replyTo: z.string().nullable().openapi({ example: "m20", description: "The reply whose sub-thread this reply is in; null for a reply in the thread itself" }),
    blocks: z.array(Block).openapi({ description: "Typed blocks: approval, deliverable, decision, hand-off" }),
    reactions: z.array(Reaction),
    files: z.array(FileRef),
  })
  .openapi("Reply")

export const Event = z
  .object({ kind: z.literal("event"), id: z.string(), who: z.string(), at: timestamp, text: z.string(), system: z.boolean(), blocks: z.array(Block) })
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
    to: z.string().nullable().openapi({ example: "codex", description: "The member the question is for; only they answer it. null: a person answers" }),
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
    labels: messageLabels,
    editedAt,
    taskId: z.number().int().nullable(),
    threadId: z.string().nullable(),
    blocks: z.array(Block),
    thread: orNull(ThreadSummary),
    reactions: z.array(Reaction),
    files: z.array(FileRef),
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

export const MessageVersion = z
  .object({
    version: z.number().int().openapi({ example: 1, description: "1 is the text as posted; each edit adds one" }),
    text: z.string(),
    mentions: z.array(z.string()),
    at: timestamp.openapi({ description: "When this version was written" }),
    current: z.boolean(),
  })
  .openapi("MessageVersion")

export const MessageVersions = z
  .object({
    id: z.string().openapi({ example: "m12" }),
    deleted: z.boolean(),
    versions: z.array(MessageVersion).openapi({ description: "Oldest first, the current text last; empty when the message was deleted" }),
  })
  .openapi("MessageVersions")

export const MessageState = z
  .object({
    id: z.string().openapi({ example: "m12" }),
    channel: z.string(),
    threadId: z.string().openapi({ description: "The thread the message is in, or its own id for a message in the channel" }),
    who: z.string(),
    text: z.string(),
    mentions: z.array(z.string()),
    labels: z.array(z.string()),
    editedAt,
    version: z.number().int().openapi({ description: "The current version number" }),
  })
  .openapi("MessageState")

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
export type ChannelKind = z.infer<typeof ChannelKind>
export type Member = z.infer<typeof Member>
export type Question = z.infer<typeof Question>
export type Task = z.infer<typeof Task>
export type TaskCommit = z.infer<typeof TaskCommit>
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
export type Label = z.infer<typeof Label>
export type MessageVersion = z.infer<typeof MessageVersion>
export type MessageVersions = z.infer<typeof MessageVersions>
export type MessageState = z.infer<typeof MessageState>
export type Activity = z.infer<typeof Activity>
export type BoardEvent = z.infer<typeof BoardEvent>
export type EventPage = z.infer<typeof EventPage>
