import { z } from "@hono/zod-openapi"
import { MemberKind } from "./board"

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-28T10:40:02.000Z" })

export const ChannelReader = z
  .object({
    member: z.string().openapi({ example: "acme-bot" }),
    kind: MemberKind,
    org: z.string().openapi({ example: "acme" }),
    lastReadId: z.string().nullable().openapi({ example: "m12", description: "The last feed item the member has read; null before their first read" }),
    readAt: timestamp.nullable().openapi({ description: "When the cursor last moved" }),
    backlog: z.number().int().openapi({ example: 9, description: "Feed items after the cursor written by someone else" }),
    behindSince: timestamp.nullable().openapi({ description: "When the oldest of those was posted; null when up to date. A cursor behind for long while work waits means a stuck reader" }),
  })
  .openapi("ChannelReader")

export const MarkReadQuery = z.object({
  upTo: z.string().regex(/^m\d+$/).optional().openapi({ example: "m12", description: "Move the cursor only as far as this message (a reply counts as the feed item before it). Never moves it back" }),
})

export const ReadCursor = z.object({ lastReadId: z.number().int() }).openapi("ReadCursor")

export type ChannelReader = z.infer<typeof ChannelReader>
export type MarkReadQuery = z.infer<typeof MarkReadQuery>
