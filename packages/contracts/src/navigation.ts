import { z } from "@hono/zod-openapi"
import { draftKinds, navigationLimits } from "./constants"

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })

export const OpenDmBody = z
  .object({ with: z.string().min(1).openapi({ description: "The member to talk to, a person or an agent", example: "claude" }) })
  .openapi("OpenDmBody")

export const DraftKind = z.enum(draftKinds).openapi("DraftKind")

export const Draft = z
  .object({
    kind: DraftKind.openapi({ description: "channel: the message box of a channel or dm; thread: the reply box of a thread" }),
    target: z.string().openapi({ description: "The channel id, or the thread id (m12 or 806)", example: "backend" }),
    channel: z.string().openapi({ description: "The channel the draft belongs to", example: "backend" }),
    text: z.string(),
    updatedAt: timestamp,
  })
  .openapi("Draft")

export const SaveDraftBody = z
  .object({
    kind: DraftKind,
    target: z.string().min(1).openapi({ example: "backend" }),
    text: z.string().max(navigationLimits.draftChars).openapi({ description: "The unsent text; empty clears the draft" }),
  })
  .openapi("SaveDraftBody")

export const SaveDraftResult = z.object({ draft: Draft.nullable().openapi({ description: "null when the text was empty and the draft is cleared" }) }).openapi("SaveDraftResult")

export const SavedState = z.object({ id: z.string().openapi({ example: "m12" }), saved: z.boolean() }).openapi("SavedState")

export const SavedItem = z
  .object({
    id: z.string().openapi({ example: "m12" }),
    channel: z.string(),
    threadId: z.string().openapi({ description: "The thread to open: the message itself, its parent message or its task" }),
    taskId: z.number().int().nullable(),
    who: z.string(),
    at: timestamp,
    text: z.string().openapi({ description: "Empty once the message is deleted" }),
    deleted: z.boolean(),
    savedAt: timestamp,
  })
  .openapi("SavedItem")

export const MyThread = z
  .object({
    threadId: z.string().openapi({ description: "m12 for a message thread, 806 for a task thread", example: "m12" }),
    channel: z.string(),
    taskId: z.number().int().nullable(),
    title: z.string().openapi({ description: "The thread's first message, or the task's title" }),
    startedBy: z.string(),
    replies: z.number().int(),
    lastAt: timestamp,
    lastWho: z.string(),
    lastText: z.string(),
    unread: z.number().int().openapi({ description: "Replies by others since the acting member last wrote in the thread" }),
  })
  .openapi("MyThread")

export const SentItem = z
  .object({
    id: z.string().openapi({ example: "m12" }),
    kind: z.enum(["message", "reply"]),
    channel: z.string(),
    threadId: z.string(),
    taskId: z.number().int().nullable(),
    at: timestamp,
    text: z.string(),
  })
  .openapi("SentItem")

export type OpenDmBody = z.infer<typeof OpenDmBody>
export type Draft = z.infer<typeof Draft>
export type DraftKind = z.infer<typeof DraftKind>
export type SaveDraftBody = z.infer<typeof SaveDraftBody>
export type SaveDraftResult = z.infer<typeof SaveDraftResult>
export type SavedState = z.infer<typeof SavedState>
export type SavedItem = z.infer<typeof SavedItem>
export type MyThread = z.infer<typeof MyThread>
export type SentItem = z.infer<typeof SentItem>
