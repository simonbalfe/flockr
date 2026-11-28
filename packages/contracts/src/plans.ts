import { z } from "@hono/zod-openapi"
import { waitLimits } from "./connect"
import type { TaskState } from "./board"
import { Task, ThreadQuestion } from "./board"

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-25T09:00:00.000Z" })

export const planLimits = { titleChars: 120, goalChars: 2000, keyChars: 80, openPerChannel: 50, focusDone: 50, recentSteps: 3 } as const

export const planStates = ["open", "closed"] as const
export type PlanState = (typeof planStates)[number]

export const threadStatuses = ["needs_you", "running", "blocked", "unread", "done", "quiet"] as const
export type ThreadStatus = (typeof threadStatuses)[number]

export const PlanStateSchema = z.enum(planStates).openapi("PlanState")
export const ThreadStatusSchema = z.enum(threadStatuses).openapi("ThreadStatus")

export const PlanProgress = z
  .object({
    total: z.number().int(),
    waiting: z.number().int(),
    ready: z.number().int(),
    claimed: z.number().int(),
    blocked: z.number().int(),
    review: z.number().int(),
    done: z.number().int(),
    failed: z.number().int(),
    canceled: z.number().int(),
  })
  .openapi("PlanProgress")

export const Plan = z
  .object({
    id: z.number().int().openapi({ example: 3 }),
    channel: z.string().openapi({ example: "backend" }),
    title: z.string().openapi({ example: "Users API" }),
    goal: z.string().nullable().openapi({ example: "A users API with sign-up behind it this week" }),
    state: PlanStateSchema,
    createdBy: z.string().openapi({ example: "lead" }),
    createdAt: timestamp,
    closedAt: timestamp.nullable(),
    progress: PlanProgress,
  })
  .openapi("Plan")

export const PlanDetail = Plan.extend({ tasks: z.array(Task).openapi({ description: "The plan's tasks, in creation order" }) }).openapi("PlanDetail")

export const CreatePlanBody = z
  .object({
    channel: z.string(),
    title: z.string().trim().min(1).max(planLimits.titleChars),
    goal: z.string().trim().max(planLimits.goalChars).nullable().default(null),
    key: z.string().trim().min(1).max(planLimits.keyChars).optional().openapi({ description: "Repeat-safe: a second create with the same key in the same channel returns the first plan and writes nothing" }),
  })
  .openapi("CreatePlanBody")

export const UpdatePlanBody = z
  .object({
    title: z.string().trim().min(1).max(planLimits.titleChars).optional(),
    goal: z.string().trim().max(planLimits.goalChars).nullable().optional(),
  })
  .openapi("UpdatePlanBody")

export const SetTaskPlanBody = z
  .object({ plan: z.number().int().nullable().openapi({ description: "The plan to put the task in, or null to take it out" }) })
  .openapi("SetTaskPlanBody")

export const ListPlansQuery = z.object({
  channel: z.string().optional(),
  state: PlanStateSchema.optional().openapi({ description: "Default open" }),
})

export const RunStep = z
  .object({
    kind: z.string().openapi({ example: "edit" }),
    text: z.string().openapi({ example: "apps/server/src/routes/users.ts" }),
    at: timestamp,
  })
  .openapi("RunStep")

export const FocusRun = z
  .object({
    agent: z.string().openapi({ example: "codex" }),
    channel: z.string(),
    threadId: z.string().openapi({ description: "A task id such as 812, or a message id such as m12 for a conversation" }),
    taskId: z.number().int().nullable(),
    title: z.string().openapi({ example: "Build the /users API" }),
    startedAt: timestamp,
    steps: z.number().int().openapi({ description: "Steps taken in this run so far" }),
    recent: z.array(RunStep).max(planLimits.recentSteps).openapi({ description: "The last few steps, newest last" }),
    leaseExpiresAt: timestamp.nullable(),
  })
  .openapi("FocusRun")

export const Focus = z
  .object({
    needsYou: z
      .object({
        questions: z.array(Task),
        threadQuestions: z.array(ThreadQuestion),
        reviews: z.array(Task),
        blocked: z.array(Task),
      })
      .openapi({ description: "Everything waiting on a person, oldest first within each list" }),
    plans: z.array(Plan).openapi({ description: "Open plans, newest first" }),
    running: z.array(FocusRun),
    doneToday: z.array(Task).openapi({ description: "Tasks done since 00:00 UTC, newest first" }),
  })
  .openapi("Focus")

export type PlanProgress = z.infer<typeof PlanProgress>
export type Plan = z.infer<typeof Plan>
export type PlanDetail = z.infer<typeof PlanDetail>
export type CreatePlanBody = z.infer<typeof CreatePlanBody>
export type UpdatePlanBody = z.infer<typeof UpdatePlanBody>
export type SetTaskPlanBody = z.infer<typeof SetTaskPlanBody>
export type RunStep = z.infer<typeof RunStep>
export type FocusRun = z.infer<typeof FocusRun>
export type Focus = z.infer<typeof Focus>

export const planFinishedStates = ["done", "canceled"] as const satisfies readonly TaskState[]

export const PlanWaitQuery = z.object({
  timeout: z.coerce
    .number()
    .int()
    .min(0)
    .max(waitLimits.maxSeconds)
    .default(waitLimits.defaultSeconds)
    .openapi({ type: "integer", description: `Seconds to wait, at most ${waitLimits.maxSeconds}; 0 checks once` }),
})

export const PlanWait = z
  .object({
    plan: PlanDetail,
    finished: z.boolean().openapi({ description: "Every task of the plan is done or canceled. A failed task keeps it open: it needs a decision" }),
    open: z.array(z.number().int()).openapi({ description: "The tasks still open, in creation order", example: [812, 814] }),
    timedOut: z.boolean(),
  })
  .openapi("PlanWait")

export type PlanWaitQuery = z.infer<typeof PlanWaitQuery>
export type PlanWait = z.infer<typeof PlanWait>
