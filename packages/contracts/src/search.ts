import { z } from "@hono/zod-openapi"
import { TaskState } from "./board"

export const searchLimits = { queryLength: 200, defaultHits: 20, maxHits: 50, snippetWords: 24 } as const

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(searchLimits.queryLength).openapi({ description: "Words to find; the last word also matches as a prefix", example: "rate limit" }),
  channel: z.string().optional().openapi({ description: "Only hits in this channel", example: "backend" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(searchLimits.maxHits)
    .default(searchLimits.defaultHits)
    .openapi({ type: "integer", description: `At most this many hits, default ${searchLimits.defaultHits}` }),
})

export const SnippetPart = z
  .object({ text: z.string(), match: z.boolean().openapi({ description: "true for a word that matched the query" }) })
  .openapi("SnippetPart")

export const MessageHit = z
  .object({
    kind: z.literal("message"),
    id: z.string().openapi({ example: "m12" }),
    channel: z.string(),
    threadId: z.string().openapi({ description: "The thread to open: the message itself, its parent message (m12) or its task (806)" }),
    taskId: z.number().int().nullable().openapi({ description: "The task whose thread holds this reply, if any" }),
    who: z.string(),
    at: timestamp,
    snippet: z.array(SnippetPart),
    rank: z.number(),
  })
  .openapi("MessageHit")

export const TaskHit = z
  .object({
    kind: z.literal("task"),
    id: z.number().int().openapi({ example: 806 }),
    channel: z.string(),
    title: z.string(),
    state: TaskState,
    who: z.string().nullable().openapi({ description: "Who made the task" }),
    at: timestamp,
    snippet: z.array(SnippetPart),
    rank: z.number(),
  })
  .openapi("TaskHit")

export const SearchHit = z.discriminatedUnion("kind", [MessageHit, TaskHit]).openapi("SearchHit")

export const SearchResult = z
  .object({ query: z.string(), hits: z.array(SearchHit).openapi({ description: "Best first: an exact phrase beats scattered words, then newer first" }) })
  .openapi("SearchResult")

export type SearchQuery = z.infer<typeof SearchQuery>
export type SnippetPart = z.infer<typeof SnippetPart>
export type MessageHit = z.infer<typeof MessageHit>
export type TaskHit = z.infer<typeof TaskHit>
export type SearchHit = z.infer<typeof SearchHit>
export type SearchResult = z.infer<typeof SearchResult>
