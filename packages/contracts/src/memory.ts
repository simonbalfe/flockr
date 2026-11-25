import { z } from "@hono/zod-openapi"
import type { MemberKind } from "./board"

// Agent notes (10a) and channel memory (10b) are one family of short items; the scope says whose.
export const memoryScopes = ["agent", "channel"] as const
export type MemoryScope = (typeof memoryScopes)[number]

export const memoryKinds = ["dead-end", "decision", "preference", "fact", "todo"] as const
export type MemoryKind = (typeof memoryKinds)[number]

export const memoryKindLabels = { "dead-end": "Dead end", decision: "Decision", preference: "Preference", fact: "Fact", todo: "To do" } as const satisfies Record<MemoryKind, string>

export const memoryStates = ["active", "archived"] as const
export type MemoryState = (typeof memoryStates)[number]

export const memoryLimits = {
  textMax: 500,
  tagsMax: 5,
  tagMax: 30,
  keyMax: 100,
  // Live items per owner; the add that would pass it is refused until one is archived (ADR 0026).
  agentItems: 100,
  channelItems: 100,
  listMax: 200,
  // What the runner puts in a prompt: whole items, best first, until the characters are used up.
  promptNotesChars: 3000,
  promptChannelChars: 3000,
} as const satisfies Record<string, number>

export const memoryItemCap = { agent: memoryLimits.agentItems, channel: memoryLimits.channelItems } as const satisfies Record<MemoryScope, number>

export const memoryEventTypes = {
  added: "memory.added",
  updated: "memory.updated",
  archived: "memory.archived",
  restored: "memory.restored",
} as const

// The runner puts dead ends first so an agent does not retry a failed approach, then decisions, preferences, facts and to dos.
export const memoryKindOrder = memoryKinds

// An agent keeps its own notes and a person may read and change any agent's; one agent never reads another's.
export const mayUseAgentNotes = ({ actor, agent }: { actor: { name: string; kind: MemberKind }; agent: string }): boolean => actor.kind === "person" || actor.name === agent

// Channel memory is open to read and add for every member; a person changes any item, an agent only the ones it added.
export const mayChangeChannelMemory = ({ actor, createdBy }: { actor: { name: string; kind: MemberKind }; createdBy: string }): boolean => actor.kind === "person" || actor.name === createdBy

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-25T08:00:00.000Z" })

const Text = z.string().trim().min(1).max(memoryLimits.textMax)
const Tag = z.string().trim().min(1).max(memoryLimits.tagMax)
const Tags = z.array(Tag).max(memoryLimits.tagsMax).transform((tags) => [...new Set(tags)])
const SourceThread = z.string().trim().regex(/^(m\d+|\d+)$/, "A thread id such as m12, or a task id such as 806")

export const MemoryKindSchema = z.enum(memoryKinds).openapi("MemoryKind", { description: "dead-end, decision, preference, fact or todo" })

export const MemoryItem = z
  .object({
    id: z.number().int().openapi({ example: 7 }),
    scope: z.enum(memoryScopes),
    owner: z.string().openapi({ description: "The agent's name for an agent note, the channel id for channel memory", example: "claude" }),
    kind: MemoryKindSchema,
    text: z.string().openapi({ example: "Use uuid primary keys; decided in thread m12" }),
    tags: z.array(z.string()),
    sourceThread: z.string().nullable().openapi({ description: "The thread it came from: a message id such as m12 or a task id such as 806" }),
    createdBy: z.string(),
    updatedBy: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: timestamp.nullable().openapi({ description: "Set when archived; an archived item is left out of lists and prompts until restored" }),
  })
  .openapi("MemoryItem")

export const AddMemoryBody = z
  .object({
    text: Text.openapi({ example: "Use uuid primary keys" }),
    kind: MemoryKindSchema.default("fact"),
    tags: Tags.default([]),
    sourceThread: SourceThread.nullable().default(null),
    key: z.string().trim().min(1).max(memoryLimits.keyMax).optional().openapi({ description: "Makes a retry safe: adding with a key that was used before returns that item and changes nothing" }),
  })
  .openapi("AddMemoryBody")

export const UpdateMemoryBody = z
  .object({ text: Text.optional(), kind: MemoryKindSchema.optional(), tags: Tags.optional(), sourceThread: SourceThread.nullable().optional() })
  .refine((b) => b.text !== undefined || b.kind !== undefined || b.tags !== undefined || b.sourceThread !== undefined, { error: "Change at least one of text, kind, tags or sourceThread" })
  .openapi("UpdateMemoryBody")

export const MemoryListQuery = z.object({
  state: z.enum(memoryStates).default("active").openapi({ description: "active (default) or archived" }),
  limit: z.coerce.number().int().min(1).max(memoryLimits.listMax).default(memoryLimits.listMax).openapi({ type: "integer", description: `At most this many, newest first; default and most ${memoryLimits.listMax}` }),
  before: z.coerce.number().int().min(1).optional().openapi({ type: "integer", description: "Only items with a smaller id than this, for the next page" }),
})

const itemId = z.coerce.number().int().openapi({ type: "integer", example: 7 })
export const AgentNoteParams = z.object({
  name: z.string().openapi({ param: { name: "name", in: "path" }, example: "claude" }),
  id: itemId.openapi({ param: { name: "id", in: "path", required: true } }),
})
export const ChannelMemoryParams = z.object({
  channel: z.string().openapi({ param: { name: "channel", in: "path" }, example: "backend" }),
  id: itemId.openapi({ param: { name: "id", in: "path", required: true } }),
})

export type MemoryItem = z.infer<typeof MemoryItem>
export type AddMemoryBody = z.infer<typeof AddMemoryBody>
export type UpdateMemoryBody = z.infer<typeof UpdateMemoryBody>
export type MemoryListQuery = z.infer<typeof MemoryListQuery>
