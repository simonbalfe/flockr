import { z } from "@hono/zod-openapi"
import { ApprovalAction } from "./activity"
import { Activity, MemberKind, orNull, Task, TaskState, TextMessage } from "./board"

const text = z.string().trim().min(1)
const epoch = z.number().int().optional().openapi({ description: "The claimEpoch from your claim. A stale value is refused with 409." })

export const ChannelParams = z.object({ channel: z.string().openapi({ param: { name: "channel", in: "path" }, example: "backend" }) })
export const TaskParams = z.object({ id: z.coerce.number().int().openapi({ type: "integer", param: { name: "id", in: "path", required: true }, example: 806 }) })
export const ThreadParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, description: "A message id such as m12, or a task id such as 806", example: "806" }),
})
export const MessageParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, description: "A message id such as m12", example: "m12" }),
})
export const MemberParams = z.object({ name: z.string().openapi({ param: { name: "name", in: "path" }, example: "reviewer" }) })

export const CreateChannelBody = z
  .object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).openapi({ example: "frontend" }), topic: z.string().default("") })
  .openapi("CreateChannelBody")

export const CreateMemberBody = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/).openapi({ example: "reviewer" }),
    kind: MemberKind.default("agent"),
    owner: z.string().nullable().default(null),
    runsIn: z.string().nullable().default(null),
    source: z.string().nullable().default(null),
  })
  .openapi("CreateMemberBody")

export const PostMessageBody = z.object({ text }).openapi("PostMessageBody")
export const PostMessageResult = z.object({ message: TextMessage }).openapi("PostMessageResult")

export const ReplyBody = z.object({ text, epoch }).openapi("ReplyBody")

export const ListTasksQuery = z.object({
  channel: z.string().optional(),
  state: TaskState.optional(),
  assignee: z.string().optional(),
  member: z.string().optional().openapi({ description: "Only tasks this member holds or is assigned" }),
})

export const CreateTaskBody = z
  .object({
    channel: z.string(),
    title: text,
    assignee: z.string().nullable().default(null),
    needs: z.array(z.number().int()).default([]),
    labels: z.array(z.string()).default([]),
    kind: z.string().min(1).default("build"),
    spec: z.string().nullable().default(null),
    text: z.string().optional().openapi({ description: "A first reply for the task thread" }),
  })
  .openapi("CreateTaskBody")

export const ClaimNextBody = z
  .object({
    labels: z.array(z.string()).default([]).openapi({ description: "Only tasks that carry every one of these labels" }),
    mine: z.boolean().default(false).openapi({ description: "Only tasks assigned to the acting member" }),
  })
  .openapi("ClaimNextBody")

export const ClaimResult = z.object({ task: orNull(Task) }).openapi("ClaimResult")

export const FenceBody = z.object({ epoch }).openapi("FenceBody")
export const ReleaseBody = z
  .object({
    epoch,
    keepAssignee: z.boolean().default(false).openapi({
      description: "Releasing a task assigned to you also unassigns it, so you decline it. Send true to give back only the claim and stay assigned.",
    }),
  })
  .openapi("ReleaseBody")
export const GiveBody = z.object({ to: z.string() }).openapi("GiveBody")
export const CompleteBody = z
  .object({ epoch, commit: z.string().optional(), note: z.string().optional().openapi({ description: "Proof of the work, posted in the thread" }) })
  .openapi("CompleteBody")
export const ReasonBody = z.object({ reason: text, epoch }).openapi("ReasonBody")
export const ChangesBody = z.object({ note: z.string().optional() }).openapi("ChangesBody")
export const AskBody = z
  .object({
    text,
    detail: z.string().default(""),
    options: z.array(text).min(2).openapi({ example: ["Run it", "Not now"] }),
    note: z.string().optional().openapi({ description: "A reply posted in the thread with the question" }),
    action: ApprovalAction.optional().openapi({ description: "For a permission request: the exact tool call, command, input or diff to approve" }),
    epoch,
  })
  .openapi("AskBody")
export const AnswerBody = z.object({ option: text }).openapi("AnswerBody")
export const ThreadAskBody = z
  .object({
    text,
    detail: z.string().default(""),
    options: z.array(text).min(2).openapi({ example: ["Allow once", "Deny"] }),
    action: ApprovalAction.optional().openapi({ description: "For a permission request: the exact tool call, command, input or diff to approve" }),
  })
  .openapi("ThreadAskBody")
export const ActivityBody = z
  .object({ working: z.boolean().openapi({ description: "true while the acting member works in the thread; false when it stops" }) })
  .openapi("ActivityBody")
export const ActivityResult = z.object({ activity: orNull(Activity) }).openapi("ActivityResult")

export const EventsQuery = z.object({
  since: z.coerce.number().int().min(0).default(0).openapi({ type: "integer", description: "Return events after this sequence number, default 0" }),
  limit: z.coerce.number().int().min(1).max(1000).default(500).openapi({ type: "integer", description: "At most this many events, default 500" }),
})

export type ClaimNextBody = z.infer<typeof ClaimNextBody>
export type CreateTaskBody = z.infer<typeof CreateTaskBody>
export type CreateMemberBody = z.infer<typeof CreateMemberBody>
export type AskBody = z.infer<typeof AskBody>
export type CompleteBody = z.infer<typeof CompleteBody>
export type ThreadAskBody = z.infer<typeof ThreadAskBody>
export type ListTasksQuery = z.infer<typeof ListTasksQuery>
export type ReleaseBody = z.infer<typeof ReleaseBody>
