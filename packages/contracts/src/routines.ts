import { z } from "@hono/zod-openapi"
import { Task, ThreadQuestion } from "./board"
import { parseCron } from "./cron"

export const jobStates = ["queued", "running", "waiting", "done", "failed", "skipped"] as const
export type JobState = (typeof jobStates)[number]

export const jobKinds = ["routine", "post"] as const
export type JobKind = (typeof jobKinds)[number]

export const routineTriggerKinds = ["cron", "event"] as const
export type RoutineTriggerKind = (typeof routineTriggerKinds)[number]

export const routineActionKinds = ["post", "task", "mention", "brief"] as const
export type RoutineActionKind = (typeof routineActionKinds)[number]

export const watchableEventTypes = [
  "message.posted",
  "reply.posted",
  "question.asked",
  "question.answered",
  "task.created",
  "task.ready",
  "task.claimed",
  "task.blocked",
  "task.unblocked",
  "task.asked",
  "task.answered",
  "task.submitted",
  "task.changes_requested",
  "task.completed",
  "task.approved",
  "task.failed",
  "task.expired",
  "task.planned",
  "plan.created",
  "plan.updated",
  "plan.closed",
  "plan.reopened",
] as const
export type WatchableEventType = (typeof watchableEventTypes)[number]

export const routineActor = "flockr"

export const routineLimits = {
  nameMax: 80,
  textMax: 4000,
  perHourDefault: 4,
  perHourMax: 60,
  totalPerHour: 60,
  recentJobs: 5,
  recentJobsMax: 50,
  briefHours: 24,
} as const

export const jobLimits = {
  maxAttempts: 5,
  backoffBaseSeconds: 30,
  backoffMaxSeconds: 3600,
  lockSeconds: 120,
  batch: 20,
  drainEverySeconds: 10,
  errorMax: 1000,
} as const

export const routineEventTypes = {
  created: "routine.created",
  updated: "routine.updated",
  enabled: "routine.enabled",
  disabled: "routine.disabled",
  deleted: "routine.deleted",
} as const

export const jobEventTypes = { finished: "job.finished", retrying: "job.retrying", failed: "job.failed", waiting: "job.waiting", approved: "job.approved" } as const

export const jobStateLabels = { queued: "Queued", running: "Running", waiting: "Waiting for approval", done: "Done", failed: "Failed", skipped: "Skipped" } as const satisfies Record<JobState, string>

export const routineActionLabels = { post: "Post a message", task: "Create a task", mention: "Mention an agent", brief: "Post the morning brief" } as const satisfies Record<RoutineActionKind, string>

export const routineTriggerLabels = { cron: "On a schedule", event: "On an event" } as const satisfies Record<RoutineTriggerKind, string>

export const backoffSeconds = (attempts: number): number => Math.min(jobLimits.backoffMaxSeconds, jobLimits.backoffBaseSeconds * 2 ** Math.max(0, attempts - 1))

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-25T08:00:00.000Z" })
const text = z.string().trim().min(1).max(routineLimits.textMax)

export const CronSchedule = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const parsed = parseCron(value)
    if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.error })
  })
  .openapi({ example: "0 8 * * 1-5", description: "Five fields in UTC: minute hour day-of-month month day-of-week, each *, a value, a list (1,15), a range (1-5) or a step (*/15)" })

export const WatchableEventType = z.enum(watchableEventTypes).openapi("WatchableEventType")
export const JobStateSchema = z.enum(jobStates).openapi("JobState", {
  description: "queued: waits for its run time. running: claimed by a drainer. waiting: its action needs a person's approval, and a question card in the routine's channel holds it until Allow once (it runs) or Deny (it is skipped). done: it acted. skipped: it did not act (the routine was off, deleted, over a limit, blocked or denied). failed: it gave up after its last attempt; lastError says why.",
})

export const RoutineTrigger = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("cron"), schedule: CronSchedule }).openapi("CronTrigger"),
    z.object({ kind: z.literal("event"), eventType: WatchableEventType.openapi({ description: "Fires once for each new event of this type in the routine's channel" }) }).openapi("EventTrigger"),
  ])
  .openapi("RoutineTrigger")

export const RoutineAction = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("post"), text }).openapi("PostAction"),
    z.object({ kind: z.literal("task"), title: text, assignee: z.string().nullable().default(null) }).openapi("TaskAction"),
    z.object({ kind: z.literal("mention"), agent: z.string().min(1).openapi({ example: "claude" }), text }).openapi("MentionAction"),
    z.object({ kind: z.literal("brief") }).openapi("BriefAction"),
  ])
  .openapi("RoutineAction", { description: "post a message, create a task, post @agent text so the agent starts a conversation, or post the morning brief" })

export const JobCause = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("cron"), scheduledFor: timestamp }),
    z.object({ kind: z.literal("event"), seq: z.number().int(), type: z.string() }),
  ])
  .openapi("JobCause")

export const Job = z
  .object({
    id: z.number().int(),
    kind: z.enum(jobKinds),
    routineId: z.number().int().nullable(),
    state: JobStateSchema,
    cause: JobCause,
    runAt: timestamp,
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    result: z.string().nullable().openapi({ description: "What it did, such as posted m42, why it was skipped, or the question it waits on" }),
    lastError: z.string().nullable(),
    createdAt: timestamp,
    finishedAt: timestamp.nullable(),
  })
  .openapi("Job")

const PerHour = z.number().int().min(1).max(routineLimits.perHourMax)

export const Routine = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    name: z.string(),
    channel: z.string(),
    trigger: RoutineTrigger,
    action: RoutineAction,
    enabled: z.boolean().openapi({ description: "A routine is off until a person turns it on" }),
    perHour: PerHour.openapi({ description: "At most this many runs an hour; further firings are skipped" }),
    createdBy: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
    nextRunAt: timestamp.nullable().openapi({ description: "When a scheduled routine that is on fires next" }),
    recentJobs: z.array(Job).openapi({ description: `The last ${routineLimits.recentJobs} runs, newest first` }),
  })
  .openapi("Routine")

export const RoutineParams = z.object({ id: z.coerce.number().int().openapi({ type: "integer", param: { name: "id", in: "path", required: true }, example: 1 }) })

export const CreateRoutineBody = z
  .object({
    name: z.string().trim().min(1).max(routineLimits.nameMax).openapi({ example: "Morning brief" }),
    channel: z.string().openapi({ example: "backend" }),
    trigger: RoutineTrigger,
    action: RoutineAction,
    perHour: PerHour.default(routineLimits.perHourDefault),
  })
  .openapi("CreateRoutineBody")

export const UpdateRoutineBody = z
  .object({
    name: z.string().trim().min(1).max(routineLimits.nameMax).optional(),
    channel: z.string().optional(),
    trigger: RoutineTrigger.optional(),
    action: RoutineAction.optional(),
    perHour: PerHour.optional(),
  })
  .refine((b) => b.name !== undefined || b.channel !== undefined || b.trigger !== undefined || b.action !== undefined || b.perHour !== undefined, {
    error: "Change at least one of name, channel, trigger, action or perHour",
  })
  .openapi("UpdateRoutineBody")

export const RoutineJobsQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(routineLimits.recentJobsMax)
    .default(20)
    .openapi({ type: "integer", description: `At most this many runs, newest first; default 20, at most ${routineLimits.recentJobsMax}` }),
})

export const DeletedRoutine = z.object({ id: z.number().int(), deletedAt: timestamp }).openapi("DeletedRoutine")

export const Brief = z
  .object({
    since: timestamp,
    until: timestamp,
    text: z.string().openapi({ description: "The message the brief action posts" }),
    finished: z.array(Task).openapi({ description: "Tasks done in the window" }),
    blocked: z.array(Task).openapi({ description: "Every blocked task, with its reason" }),
    questions: z.array(Task).openapi({ description: "Tasks whose holder waits for a person's answer" }),
    threadQuestions: z.array(ThreadQuestion),
    reviews: z.array(Task),
  })
  .openapi("Brief")

export type RoutineTrigger = z.infer<typeof RoutineTrigger>
export type RoutineAction = z.infer<typeof RoutineAction>
export type JobCause = z.infer<typeof JobCause>
export type Job = z.infer<typeof Job>
export type Routine = z.infer<typeof Routine>
export type CreateRoutineBody = z.infer<typeof CreateRoutineBody>
export type UpdateRoutineBody = z.infer<typeof UpdateRoutineBody>
export type DeletedRoutine = z.infer<typeof DeletedRoutine>
export type Brief = z.infer<typeof Brief>
