import { z } from "@hono/zod-openapi"
import { activityLimits, planStepStatuses, runStatuses, stepStatuses } from "./activity-rules"

export * from "./activity-rules"

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })
const partId = z.string().trim().min(1).max(80).openapi({ example: "t1", description: "Unique within the entry; later updates name the part by it" })
const count = z.number().int().min(0)
const longText = z.string().max(activityLimits.text)
const list = <T extends z.ZodType>(item: T) => z.array(item).max(activityLimits.items)

export const StepStatus = z.enum(stepStatuses).openapi("StepStatus")
export const PlanStepStatus = z.enum(planStepStatuses).openapi("PlanStepStatus")
export const RunStatus = z.enum(runStatuses).openapi("RunStatus")
export const EndStatus = StepStatus.exclude(["running"]).openapi("EndStatus")
export const RunEndStatus = RunStatus.exclude(["running"]).openapi("RunEndStatus")

const timed = {
  status: StepStatus,
  startedAt: timestamp,
  durationMs: count.nullable().openapi({ description: "Set when the part finishes" }),
}
const timedOptional = { id: true, status: true, startedAt: true, durationMs: true } as const

export const ToolPart = z
  .object({
    id: partId,
    type: z.literal("tool"),
    name: z.string().min(1).openapi({ example: "edit_file" }),
    input: z.record(z.string(), z.unknown()).openapi({ example: { path: "src/limits.ts" } }),
    output: longText,
    ...timed,
  })
  .openapi("ToolPart")

export const TerminalPart = z
  .object({
    id: partId,
    type: z.literal("terminal"),
    command: z.string().min(1).openapi({ example: "bun test" }),
    cwd: z.string().nullable(),
    output: longText.openapi({ description: "Combined stdout and stderr; only the last 20,000 characters are kept" }),
    exitCode: z.number().int().nullable(),
    ...timed,
  })
  .openapi("TerminalPart")

export const ReasoningPart = z.object({ id: partId, type: z.literal("reasoning"), text: longText, ...timed }).openapi("ReasoningPart")

export const PlanStep = z.object({ text: z.string().min(1), status: PlanStepStatus }).openapi("PlanStep")

export const PlanPart = z
  .object({ id: partId, type: z.literal("plan"), title: z.string().nullable(), steps: list(PlanStep) })
  .openapi("PlanPart")

export const FileChange = z
  .object({
    path: z.string().min(1).openapi({ example: "apps/server/src/limits.ts" }),
    added: count,
    removed: count,
    diff: longText.nullable().openapi({ description: "A unified diff of this file, when the agent has one" }),
  })
  .openapi("FileChange")

export const FilesPart = z.object({ id: partId, type: z.literal("files"), files: list(FileChange) }).openapi("FilesPart")

export const TestSuite = z.object({ name: z.string().min(1), passed: count, failed: count, skipped: count }).openapi("TestSuite")
export const TestFailure = z.object({ name: z.string().min(1), message: z.string(), location: z.string().nullable() }).openapi("TestFailure")

export const TestsPart = z
  .object({
    id: partId,
    type: z.literal("tests"),
    command: z.string().nullable(),
    passed: count,
    failed: count,
    skipped: count,
    suites: list(TestSuite),
    failures: list(TestFailure),
    ...timed,
  })
  .openapi("TestsPart")

export const SubagentPart = z
  .object({
    id: partId,
    type: z.literal("subagent"),
    name: z.string().min(1).openapi({ example: "explorer" }),
    task: z.string().min(1),
    summary: longText,
    ...timed,
  })
  .openapi("SubagentPart")

export const StackFrame = z
  .object({ function: z.string().nullable(), file: z.string().min(1), line: z.number().int().nullable(), column: z.number().int().nullable() })
  .openapi("StackFrame")

export const ErrorPart = z
  .object({ id: partId, type: z.literal("error"), name: z.string().nullable(), message: z.string().min(1), frames: list(StackFrame) })
  .openapi("ErrorPart")

export const ActivityPart = z
  .discriminatedUnion("type", [ToolPart, TerminalPart, ReasoningPart, PlanPart, FilesPart, TestsPart, SubagentPart, ErrorPart])
  .openapi("ActivityPart")

export const ActivityPartInput = z
  .discriminatedUnion("type", [
    ToolPart.partial({ ...timedOptional, input: true, output: true }).openapi("ToolPartInput"),
    TerminalPart.partial({ ...timedOptional, cwd: true, output: true, exitCode: true }).openapi("TerminalPartInput"),
    ReasoningPart.partial(timedOptional).openapi("ReasoningPartInput"),
    PlanPart.partial({ id: true, title: true }).openapi("PlanPartInput"),
    FilesPart.partial({ id: true })
      .extend({ files: list(FileChange.partial({ added: true, removed: true, diff: true })) })
      .openapi("FilesPartInput"),
    TestsPart.partial({ ...timedOptional, command: true, skipped: true, suites: true })
      .extend({ failures: list(TestFailure.partial({ location: true })).optional() })
      .openapi("TestsPartInput"),
    SubagentPart.partial({ ...timedOptional, summary: true }).openapi("SubagentPartInput"),
    ErrorPart.partial({ id: true, name: true })
      .extend({ frames: list(StackFrame.partial({ function: true, line: true, column: true })).optional() })
      .openapi("ErrorPartInput"),
  ])
  .openapi("ActivityPartInput", { description: "A part as an agent sends it: id, status, times and empty outputs may be left out" })

export const ActivityUpdate = z
  .discriminatedUnion("type", [
    z
      .object({ type: z.literal("part.set"), part: ActivityPartInput })
      .openapi("PartSet", { description: "Add a part, or replace the part with the same id (AG-UI tool call start, state snapshot)" }),
    z
      .object({ type: z.literal("part.append"), partId, text: z.string().min(1) })
      .openapi("PartAppend", { description: "Append streamed text: a tool's or command's output, reasoning text, a subagent's summary (AG-UI content and args chunks)" }),
    z
      .object({
        type: z.literal("part.finished"),
        partId,
        status: EndStatus,
        output: longText.optional().openapi({ description: "Replaces the streamed output" }),
        exitCode: z.number().int().optional(),
        durationMs: count.optional().openapi({ description: "Left out, the server measures from the part's start" }),
      })
      .openapi("PartFinished", { description: "A tool call, command, thought, test run or subagent ended (AG-UI tool call end and result)" }),
    z
      .object({ type: z.literal("run.finished"), status: RunEndStatus, title: z.string().trim().min(1).optional() })
      .openapi("RunFinished", { description: "The run behind this entry ended; parts still running end with it (AG-UI run finished or run error)" }),
  ])
  .openapi("ActivityUpdate")

export const ActivityState = z
  .object({
    title: z.string().min(1),
    runId: z.string().nullable(),
    key: z.string().nullable(),
    status: RunStatus,
    revision: z.number().int().min(1),
    updatedAt: timestamp,
    endedAt: timestamp.nullable(),
    stopRequestedAt: timestamp.nullable(),
    parts: z.array(ActivityPart).max(activityLimits.parts),
  })
  .openapi("ActivityState")

export const ActivityEntry = ActivityState.omit({ key: true })
  .extend({
    kind: z.literal("activity"),
    id: z.string().openapi({ example: "m41", description: "The entry's own message id" }),
    threadId: z.string().openapi({ description: "The thread it lives in: a message id such as m12 or a task id such as 806" }),
    channel: z.string(),
    who: z.string(),
    at: timestamp,
  })
  .openapi("ActivityEntry")

export const ApprovalAction = z
  .object({
    tool: z.string().min(1).openapi({ example: "Bash" }),
    command: z.string().optional().openapi({ example: "rm -rf dist" }),
    input: z.record(z.string(), z.unknown()).optional(),
    path: z.string().optional().openapi({ description: "The file an edit would change" }),
    diff: longText.optional().openapi({ description: "A unified diff of the edit being approved" }),
  })
  .openapi("ApprovalAction")

const entryText = z.string().trim().min(1).max(200)

export const CreateActivityBody = z
  .object({
    title: entryText.openapi({ example: "Add rate limiting to the API" }),
    runId: z.string().trim().min(1).max(120).optional().openapi({ description: "Groups the entries of one run (AG-UI runId)" }),
    key: z.string().trim().min(1).max(120).optional().openapi({ description: "Repeat-safe: a second create with the same key in the same thread returns the first entry" }),
    parts: z.array(ActivityPartInput).max(activityLimits.parts).default([]),
  })
  .openapi("CreateActivityBody")

export const UpdateActivityBody = z
  .object({
    updates: z.array(ActivityUpdate).min(1).max(activityLimits.updates),
    revision: z.number().int().min(1).optional().openapi({
      description: "The entry revision you last saw. A lower value means this update was already applied (a retry), so nothing changes and applied is false.",
    }),
  })
  .openapi("UpdateActivityBody")

export const ActivityEntryResult = z
  .object({ entry: ActivityEntry, applied: z.boolean().openapi({ description: "false when a repeated call changed nothing" }) })
  .openapi("ActivityEntryResult")

export const StopRunBody = z
  .object({
    member: z.string().optional().openapi({ description: "Whose run to stop; left out, every member working in the thread" }),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .openapi("StopRunBody")

export const StopRequest = z
  .object({ member: z.string(), threadId: z.string(), entryIds: z.array(z.string()), requestedBy: z.string(), at: timestamp, repeated: z.boolean() })
  .openapi("StopRequest")

export const StopRunResult = z.object({ requests: z.array(StopRequest) }).openapi("StopRunResult")

export const ActivityEntryParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, description: "An activity entry's message id such as m41", example: "m41" }),
})

export type ApprovalAction = z.infer<typeof ApprovalAction>
export type CreateActivityBody = z.infer<typeof CreateActivityBody>
export type UpdateActivityBody = z.infer<typeof UpdateActivityBody>
export type StopRunBody = z.infer<typeof StopRunBody>
export type StopRequest = z.infer<typeof StopRequest>

export const ActivityPostedData = z.object({ entry: ActivityEntry })
export const ActivityUpdatedData = z.object({ revision: z.number().int().min(2), at: timestamp, updates: z.array(ActivityUpdate) })
export const RunStopRequestedData = z.object({ member: z.string(), reason: z.string().nullable(), entryIds: z.array(z.string()), at: timestamp })


export type ActivityPart = z.infer<typeof ActivityPart>
export type ActivityPartInput = z.infer<typeof ActivityPartInput>
export type ActivityUpdate = z.infer<typeof ActivityUpdate>
export type ActivityState = z.infer<typeof ActivityState>
export type ActivityEntry = z.infer<typeof ActivityEntry>
export type FileChange = z.infer<typeof FileChange>
export type StackFrame = z.infer<typeof StackFrame>
export type PlanStep = z.infer<typeof PlanStep>

