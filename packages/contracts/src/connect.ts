import { z } from "@hono/zod-openapi"
import { BoardEvent } from "./board"
import { yesNo } from "./constants"

export const waitLimits = { defaultSeconds: 25, maxSeconds: 120, pollMs: 1000, page: 500 } as const

export const WaitQuery = z.object({
  since: z.coerce.number().int().min(0).optional().openapi({ type: "integer", description: "The cursor from your last wait; leave it out to wait only for new events" }),
  thread: z.string().optional().openapi({ description: "Only events in this thread, such as m12 or 806", example: "806" }),
  channel: z.string().optional().openapi({ description: "Only events in this channel", example: "acme-site" }),
  mentions: z.enum(yesNo).default("no").openapi({ description: "yes: only events that mention you" }),
  timeout: z.coerce
    .number()
    .int()
    .min(0)
    .max(waitLimits.maxSeconds)
    .default(waitLimits.defaultSeconds)
    .openapi({ type: "integer", description: `Seconds to wait before returning nothing, default ${waitLimits.defaultSeconds}, at most ${waitLimits.maxSeconds}` }),
})

export type WaitQuery = z.infer<typeof WaitQuery>

export const WaitResult = z
  .object({
    events: z.array(BoardEvent).openapi({ description: "The events that matched, oldest first; empty when the wait timed out" }),
    cursor: z.number().int().openapi({ description: "Pass this as since on the next wait" }),
    timedOut: z.boolean(),
  })
  .openapi("WaitResult")

export type WaitResult = z.infer<typeof WaitResult>
