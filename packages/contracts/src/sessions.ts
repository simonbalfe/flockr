import { z } from "@hono/zod-openapi"
import type { MemberKind } from "./board"

export const sessionFenceKinds = ["claim", "session"] as const
export type SessionFenceKind = (typeof sessionFenceKinds)[number]

export const sessionLimits = {
  chunkBytesMax: 8 * 1024 * 1024,
  sessionIdMax: 128,
  listMax: 200,
} as const satisfies Record<string, number>

export const sessionEventTypes = {
  opened: "session.opened",
  saved: "session.saved",
} as const

export const sessionPrefix = "sessions"

export const sessionSavings = ["always", "when-allowed"] as const
export type SessionSaving = (typeof sessionSavings)[number]

export const mayReadSessions = ({ actor, agent }: { actor: { name: string; kind: MemberKind }; agent: string }): boolean => actor.kind === "person" || actor.name === agent

export const SessionFence = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("claim"), task: z.number().int().min(1).openapi({ example: 806 }), epoch: z.number().int().min(1).openapi({ example: 3 }) }),
    z.object({ kind: z.literal("session"), epoch: z.number().int().min(1).openapi({ example: 2 }) }),
  ])
  .openapi("SessionFence", { description: "claim: the task's claim epoch, for a session working a claimed task. session: the session epoch on the pointer, bumped by each open" })
export type SessionFence = z.infer<typeof SessionFence>

export function fenceSegment(fence: SessionFence): string {
  switch (fence.kind) {
    case "claim":
      return `claim-${fence.task}-${fence.epoch}`
    case "session":
      return `session-${fence.epoch}`
    default: {
      const never: never = fence
      throw new Error(`Unknown fence ${JSON.stringify(never)}`)
    }
  }
}

export const unopenedFence = "unopened"

export const sessionChunkKey = (options: { agent: string; session: string; fence: string; turn: number }): string =>
  `${sessionPrefix}/${options.agent}/${options.session}/${options.fence}/${options.turn}`

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-27T08:00:00.000Z" })

export const SessionId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Letters, digits, dot, dash and underscore, starting with a letter or digit")
  .max(sessionLimits.sessionIdMax)
  .openapi({ example: "agent" })

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const SessionChunkInfo = z
  .object({
    turn: z.number().int().min(1).openapi({ example: 4 }),
    fence: z.string().openapi({ description: "The fence it was saved under, as in its object key", example: "session-2" }),
    bytes: z.number().int().min(0),
    sha256: Sha256,
    savedAt: timestamp,
  })
  .openapi("SessionChunkInfo")
export type SessionChunkInfo = z.infer<typeof SessionChunkInfo>

export const SavedSession = z
  .object({
    agent: z.string().openapi({ example: "scout" }),
    session: SessionId,
    thread: z.string().nullable().openapi({ description: "The thread the session works in, when it belongs to one", example: "806" }),
    fence: z.string().openapi({ description: "The one fence that may save the next chunk", example: "session-2" }),
    epoch: z.number().int().min(0).openapi({ description: "The session epoch; each open without a claim bumps it" }),
    taskId: z.number().int().nullable().openapi({ description: "The task whose claim fences the session, when it works one" }),
    turns: z.number().int().min(0),
    bytes: z.number().int().min(0),
    chunks: z.array(SessionChunkInfo).openapi({ description: "Every saved chunk in turn order; a restore reads exactly these" }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("SavedSession")
export type SavedSession = z.infer<typeof SavedSession>

export const SessionSummary = SavedSession.omit({ chunks: true }).openapi("SessionSummary")
export type SessionSummary = z.infer<typeof SessionSummary>

export const OpenSessionBody = z
  .object({
    claim: z
      .object({ task: z.number().int().min(1), epoch: z.number().int().min(1) })
      .nullable()
      .default(null)
      .openapi({ description: "The claim the session works under. Without one, opening bumps the session epoch so any older worker's saves are refused" }),
    thread: z.string().trim().min(1).max(64).nullable().default(null).openapi({ example: "806" }),
  })
  .openapi("OpenSessionBody")
export type OpenSessionBody = z.infer<typeof OpenSessionBody>

export const SaveChunkBody = z
  .object({
    fence: SessionFence,
    turn: z.number().int().min(1).openapi({ description: "The session's next turn number; sending a saved turn again with the same content changes nothing" }),
    data: z.base64().openapi({ description: `The chunk, base64; opaque to the board, at most ${sessionLimits.chunkBytesMax} bytes` }),
  })
  .openapi("SaveChunkBody")
export type SaveChunkBody = z.infer<typeof SaveChunkBody>

export const SaveChunkResult = z
  .object({
    saved: z.boolean().openapi({ description: "False when this exact chunk was already saved and nothing changed" }),
    session: SessionSummary,
  })
  .openapi("SaveChunkResult")
export type SaveChunkResult = z.infer<typeof SaveChunkResult>

export const SessionChunk = z
  .object({ turn: z.number().int().min(1), fence: z.string(), data: z.base64() })
  .openapi("SessionChunk")
export type SessionChunk = z.infer<typeof SessionChunk>

export const SessionParams = z.object({
  name: z.string().openapi({ param: { name: "name", in: "path" }, example: "scout" }),
  session: SessionId.openapi({ param: { name: "session", in: "path" } }),
})

export const SessionChunkParams = SessionParams.extend({
  turn: z.coerce.number().int().min(1).openapi({ param: { name: "turn", in: "path", required: true }, type: "integer", example: 1 }),
})

export const SessionListQuery = z.object({
  thread: z.string().trim().min(1).optional().openapi({ description: "Only the sessions working in this thread" }),
  limit: z.coerce.number().int().min(1).max(sessionLimits.listMax).default(50).openapi({ type: "integer", description: `Newest first; at most ${sessionLimits.listMax}` }),
})
export type SessionListQuery = z.infer<typeof SessionListQuery>
