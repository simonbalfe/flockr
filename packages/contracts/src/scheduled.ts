import { z } from "@hono/zod-openapi"

export const scheduledStates = ["scheduled", "posted", "canceled", "failed"] as const
export type ScheduledState = (typeof scheduledStates)[number]
export const scheduleLimits = { maxDays: 365, textChars: 20000 } as const

export const ScheduledPost = z
  .object({
    id: z.string().openapi({ example: "j12" }),
    channel: z.string().openapi({ example: "backend" }),
    text: z.string(),
    by: z.string().openapi({ example: "simon" }),
    at: z.string().openapi({ format: "date-time", description: "When it posts; the drainer posts it within about a minute" }),
    state: z.enum(scheduledStates),
    messageId: z.string().nullable().openapi({ example: "m60", description: "The message it became, once posted" }),
  })
  .openapi("ScheduledPost")

export const SchedulePostBody = z
  .object({
    text: z.string().trim().min(1).max(scheduleLimits.textChars),
    at: z.iso.datetime({ offset: true }).openapi({ example: "2026-11-30T09:00:00Z", description: `When to post: in the future, at most ${scheduleLimits.maxDays} days ahead` }),
    key: z.string().trim().min(1).max(100).optional().openapi({ description: "Makes a retry safe: the same key returns the first schedule" }),
  })
  .openapi("SchedulePostBody")

export const ScheduledParams = z.object({
  channel: z.string().openapi({ param: { name: "channel", in: "path" }, example: "backend" }),
  id: z.string().regex(/^j\d+$/).openapi({ param: { name: "id", in: "path" }, example: "j12" }),
})

export const ScheduledPayload = z.object({ channel: z.string(), text: z.string(), by: z.string() })

export type ScheduledPost = z.infer<typeof ScheduledPost>
export type SchedulePostBody = z.infer<typeof SchedulePostBody>
