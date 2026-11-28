import { z } from "@hono/zod-openapi"

export const reactionKinds = ["+1", "-1", "eyes", "check", "heart", "question"] as const
export type ReactionKind = (typeof reactionKinds)[number]

export const fileLimits = { bytes: 5_000_000, perMessage: 10, nameChars: 200 } as const

export const ReactionKindSchema = z.enum(reactionKinds).openapi("ReactionKind")

export const Reaction = z
  .object({
    reaction: ReactionKindSchema,
    members: z.array(z.string()).openapi({ example: ["simon", "codex"], description: "Who reacted, oldest first" }),
  })
  .openapi("Reaction")

export const ReactionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "m12", description: "A message or reply id" }),
  reaction: ReactionKindSchema.openapi({ param: { name: "reaction", in: "path" } }),
})

export const FileRef = z
  .object({
    id: z.string().openapi({ example: "f3" }),
    channel: z.string(),
    name: z.string().openapi({ example: "hero.png" }),
    contentType: z.string().openapi({ example: "image/png" }),
    size: z.number().int().openapi({ description: "Bytes" }),
    uploadedBy: z.string(),
    messageId: z.string().nullable().openapi({ description: "The message it is attached to; null until a post or reply attaches it" }),
    at: z.string().openapi({ format: "date-time" }),
  })
  .openapi("FileRef")

export const UploadFileBody = z
  .object({
    name: z.string().trim().min(1).max(fileLimits.nameChars).regex(/^[^/\\]+$/, "A file name has no slashes").openapi({ example: "hero.png" }),
    contentType: z
      .string()
      .trim()
      .regex(/^[\w.+-]+\/[\w.+-]+$/, "A content type such as image/png")
      .default("application/octet-stream"),
    data: z.string().min(1).openapi({ description: `The file's bytes, base64, at most ${fileLimits.bytes} bytes once decoded` }),
  })
  .openapi("UploadFileBody")

export const FileParams = z.object({ id: z.string().regex(/^f\d+$/).openapi({ param: { name: "id", in: "path" }, example: "f3" }) })

export const FileContent = z.object({ file: FileRef, data: z.string().openapi({ description: "The bytes, base64" }) }).openapi("FileContent")

export const fileKey = (id: string) => /^f(\d+)$/.exec(id)?.[1]

export type Reaction = z.infer<typeof Reaction>
export type FileRef = z.infer<typeof FileRef>
export type UploadFileBody = z.infer<typeof UploadFileBody>
export type FileContent = z.infer<typeof FileContent>
