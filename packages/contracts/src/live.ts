import { z } from "@hono/zod-openapi"
import { Activity, BoardEvent } from "./board"

export const LiveFrame = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello"), head: z.number().int() }),
  z.object({ kind: z.literal("event"), event: BoardEvent }),
  z.object({ kind: z.literal("activity"), activity: Activity, working: z.boolean() }),
  z.object({ kind: z.literal("agents"), names: z.array(z.string()) }),
  z.object({ kind: z.literal("resync") }),
])

export type LiveFrame = z.infer<typeof LiveFrame>
