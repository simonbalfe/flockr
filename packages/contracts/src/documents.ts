import { z } from "@hono/zod-openapi"

export const documentLimits = { chars: 20000, promptChars: 6000, noteChars: 200 } as const

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-28T10:40:02.000Z" })

export const ChannelDocument = z
  .object({
    channel: z.string().openapi({ example: "backend" }),
    version: z.number().int().openapi({ example: 4, description: "0 before the first edit. Send it as replaces when you edit" }),
    text: z.string().openapi({ example: "## Users API\n\nTable first, then the migration, then the API." }),
    editedBy: z.string().nullable().openapi({ example: "simon" }),
    editedAt: timestamp.nullable(),
    note: z.string().nullable().openapi({ description: "Why the editor changed it, in a few words" }),
    current: z.boolean().openapi({ description: "false when this is an earlier version read with ?version=" }),
  })
  .openapi("ChannelDocument")

export const DocumentVersion = z
  .object({
    version: z.number().int(),
    editedBy: z.string(),
    editedAt: timestamp,
    note: z.string().nullable(),
    chars: z.number().int(),
  })
  .openapi("DocumentVersion")

export const EditDocumentBody = z
  .object({
    text: z.string().max(documentLimits.chars).openapi({ description: `The whole new document, Markdown, at most ${documentLimits.chars} characters` }),
    replaces: z.number().int().min(0).openapi({ example: 4, description: "The version you read. When the document has moved past it the edit is refused with 409 stale_version: read it and edit again" }),
    note: z.string().trim().min(1).max(documentLimits.noteChars).optional().openapi({ example: "Sign-up waits for the email plan" }),
  })
  .openapi("EditDocumentBody")

export const DocumentQuery = z.object({
  version: z.coerce.number().int().min(1).optional().openapi({ type: "integer", description: "Read this earlier version instead of the current one" }),
})

export type ChannelDocument = z.infer<typeof ChannelDocument>
export type DocumentVersion = z.infer<typeof DocumentVersion>
export type EditDocumentBody = z.infer<typeof EditDocumentBody>
export type DocumentQuery = z.infer<typeof DocumentQuery>
