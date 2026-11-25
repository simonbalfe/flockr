import { z } from "@hono/zod-openapi"
import { ApprovalAction } from "./activity"
import { AreaPolicySchema, areaLimits } from "./areas"
import { Activity, Label, Labels, MemberKind, orNull, Task, TaskState, TextMessage } from "./board"
import { checklistLimits, checklistSkipReasons } from "./checklist"
import { commitMessageChars, Repo, Sha } from "./commits"

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
  .object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).openapi({ example: "frontend" }), topic: z.string().default(""), repo: orNull(Repo).default(null) })
  .openapi("CreateChannelBody")

export const UpdateChannelBody = z
  .object({
    topic: z.string().optional(),
    repo: orNull(Repo).optional().openapi({ description: "Set the channel's repo, or null to clear it" }),
  })
  .openapi("UpdateChannelBody")

export const CreateMemberBody = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/).openapi({ example: "reviewer" }),
    kind: MemberKind.default("agent"),
    owner: z.string().nullable().default(null),
    runsIn: z.string().nullable().default(null),
    source: z.string().nullable().default(null),
  })
  .openapi("CreateMemberBody")

const labels = Labels.default([]).openapi({ example: ["review"], description: "Labels to put on the message" })

export const PostMessageBody = z.object({ text, labels }).openapi("PostMessageBody")
export const PostMessageResult = z.object({ message: TextMessage }).openapi("PostMessageResult")

export const ReplyBody = z.object({ text, epoch, labels }).openapi("ReplyBody")

export const ListMessagesQuery = z.object({
  label: Label.optional().openapi({ description: "Only messages carrying this label, and task cards whose task carries it" }),
})

export const EditMessageBody = z
  .object({
    text: text.optional().openapi({ description: "The new text; only the author may change it. Each change is a new version" }),
    labels: Labels.optional().openapi({ description: "The full set of labels; the author, the author's owner or a person may change it" }),
  })
  .refine((body) => body.text !== undefined || body.labels !== undefined, "Give text or labels")
  .openapi("EditMessageBody")

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
  .object({
    epoch,
    commit: Sha.optional().openapi({ description: "A commit that did the work; added to the task's commits" }),
    note: z.string().optional().openapi({ description: "Proof of the work, posted in the thread" }),
  })
  .openapi("CompleteBody")
export const AddCommitBody = z
  .object({
    sha: Sha,
    message: z.string().trim().min(1).max(commitMessageChars).optional().openapi({ description: "The commit's subject line" }),
    epoch,
  })
  .openapi("AddCommitBody")
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

export const ImportChecklistBody = z
  .object({
    markdown: z
      .string()
      .min(1)
      .max(checklistLimits.markdownChars)
      .openapi({ description: "A SPEC_MASTER_CHECKLIST.md: tables of `| 1a Name | For | Delivers | Covers | Status |` rows under `## Phase N: ...` headings" }),
  })
  .openapi("ImportChecklistBody")

export const ChecklistSkip = z
  .object({
    row: z.string().openapi({ example: "1a" }),
    title: z.string().openapi({ example: "1a Skeleton" }),
    reason: z.enum(checklistSkipReasons).openapi({ description: "done: the row is already Done in the file; exists: a task with its checklist label is already in the channel" }),
    taskId: z.number().int().nullable().openapi({ description: "The task that already has this row" }),
  })
  .openapi("ChecklistSkip")

export const ChecklistImport = z
  .object({
    created: z.array(Task).openapi({ description: "New tasks in file order; each needs the task of the row before it in its phase" }),
    skipped: z.array(ChecklistSkip),
  })
  .openapi("ChecklistImport")

export const AreaParams = z.object({
  channel: z.string().openapi({ param: { name: "channel", in: "path" }, example: "backend" }),
  id: z.coerce.number().int().openapi({ type: "integer", param: { name: "id", in: "path", required: true }, example: 12 }),
})

export const DeclareAreaBody = z
  .object({
    paths: z
      .array(z.string().trim().min(1).max(areaLimits.pathChars))
      .min(1)
      .max(areaLimits.maxPaths)
      .openapi({ example: ["apps/server/src/board", "packages/contracts/**"], description: "Files, folders or globs (* ? **) in the channel's repo, no .. and no leading /" }),
    taskId: z.number().int().optional().openapi({ description: "The claimed task this work is for. The area then ends with the task's claim and is renewed with its lease. Omit for an area with its own expiry" }),
    note: z.string().trim().max(areaLimits.noteChars).optional().openapi({ description: "Why, in a few words" }),
    overlap: AreaPolicySchema.default("warn").openapi({ description: "warn (default) declares the area and returns what it overlaps; refuse declares nothing and answers 409 when it overlaps another member's live area" }),
    epoch,
  })
  .openapi("DeclareAreaBody")

export const HandoffBody = z
  .object({
    to: z.string().openapi({ example: "reviewer", description: "The member who takes the task" }),
    note: z.string().trim().min(1).optional().openapi({ description: "The summary: what is done and what is left, posted in the thread" }),
    lastCommit: Sha.optional().openapi({ description: "The last commit on the task's branch; added to the task's commits" }),
    testState: z.string().trim().min(1).max(200).optional().openapi({ example: "bun test passes, e2e not run", description: "Where the tests stand" }),
    nextSteps: z.array(z.string().trim().min(1)).max(10).default([]).openapi({ description: "What the next holder should do, in order" }),
    epoch,
  })
  .openapi("HandoffBody")

export const EventsQuery = z.object({
  since: z.coerce.number().int().min(0).default(0).openapi({ type: "integer", description: "Return events after this sequence number, default 0" }),
  limit: z.coerce.number().int().min(1).max(1000).default(500).openapi({ type: "integer", description: "At most this many events, default 500" }),
})

export type ClaimNextBody = z.infer<typeof ClaimNextBody>
export type CreateTaskBody = z.infer<typeof CreateTaskBody>
export type CreateMemberBody = z.infer<typeof CreateMemberBody>
export type AskBody = z.infer<typeof AskBody>
export type CompleteBody = z.infer<typeof CompleteBody>
export type AddCommitBody = z.infer<typeof AddCommitBody>
export type CreateChannelBody = z.infer<typeof CreateChannelBody>
export type UpdateChannelBody = z.infer<typeof UpdateChannelBody>
export type ThreadAskBody = z.infer<typeof ThreadAskBody>
export type ImportChecklistBody = z.infer<typeof ImportChecklistBody>
export type ChecklistImport = z.infer<typeof ChecklistImport>
export type ChecklistSkip = z.infer<typeof ChecklistSkip>
export type ListTasksQuery = z.infer<typeof ListTasksQuery>
export type ReleaseBody = z.infer<typeof ReleaseBody>
export type EditMessageBody = z.infer<typeof EditMessageBody>
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>
export type DeclareAreaBody = z.infer<typeof DeclareAreaBody>
export type HandoffBody = z.infer<typeof HandoffBody>
