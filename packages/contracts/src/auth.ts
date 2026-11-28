import { z } from "@hono/zod-openapi"
import { orNull } from "./board"

export const authModes = ["off", "on"] as const
export type AuthMode = (typeof authModes)[number]

export const identitySources = ["header", "session", "key"] as const
export type IdentitySource = (typeof identitySources)[number]

export const authBasePath = "/api/auth"
export const publicApiPaths = ["/api/openapi.json", "/api/docs"] as const

export const keyLimits = { secretPrefix: "fk_", shownChars: 7, channels: 20 } as const

export const keyEventTypes = { created: "key.created", revoked: "key.revoked" } as const

export const keyRevokeCauses = ["key", "all", "pause", "stop", "delete"] as const
export type KeyRevokeCause = (typeof keyRevokeCauses)[number]

export const signInWording = {
  sent: "If that address may sign in, a link is on its way. Check your email.",
  subject: "Sign in to Flockr",
  button: "Send me a link",
} as const

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })
const channelId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)

export const AuthMode = z.enum(authModes).openapi("AuthMode")
export const IdentitySource = z.enum(identitySources).openapi("IdentitySource")

export const SignInBody = z
  .object({
    email: z.email().openapi({ example: "dana@example.com" }),
    callbackURL: z.string().startsWith("/").optional().openapi({ description: "Where the link lands after signing in: a path on this board", example: "/" }),
  })
  .openapi("SignInBody")

export const SignInResult = z.object({ status: z.boolean(), message: z.string() }).openapi("SignInResult")
export const SignOutResult = z.object({ success: z.boolean() }).openapi("SignOutResult")

export const MemberKey = z
  .object({
    id: z.string().openapi({ example: "k_3f9a1c2b" }),
    member: z.string().openapi({ example: "claude" }),
    owner: z.string().nullable().openapi({ description: "The person the key's member acts for, when it is an agent" }),
    shown: z.string().openapi({ example: "fk_8Hq2", description: "The first characters of the key, to tell keys apart" }),
    channels: orNull(z.array(z.string())).openapi({ description: "The only channels the key may touch; null when it is not limited" }),
    createdBy: z.string(),
    createdAt: timestamp,
    lastUsedAt: timestamp.nullable(),
    revokedAt: timestamp.nullable(),
  })
  .openapi("MemberKey")

export const CreateKeyBody = z
  .object({
    member: z.string().openapi({ example: "claude", description: "The member the key acts as" }),
    channels: orNull(z.array(channelId).min(1).max(keyLimits.channels))
      .default(null)
      .openapi({ example: ["backend"], description: "Limit the key to these channels; it is refused everywhere else" }),
  })
  .openapi("CreateKeyBody")

export const CreatedKey = z
  .object({
    key: MemberKey,
    secret: z.string().openapi({ description: "The key itself, shown only this once. Send it as Authorization: Bearer <secret>" }),
  })
  .openapi("CreatedKey")

export const RevokedKeys = z
  .object({
    member: z.string().openapi({ example: "claude" }),
    revoked: z.array(MemberKey).openapi({ description: "The keys this call turned off; empty when the member had none live" }),
  })
  .openapi("RevokedKeys")

export const KeyParams = z.object({ id: z.string().openapi({ param: { name: "id", in: "path" }, example: "k_3f9a1c2b" }) })

export type SignInBody = z.infer<typeof SignInBody>
export type MemberKey = z.infer<typeof MemberKey>
export type CreateKeyBody = z.infer<typeof CreateKeyBody>
export type CreatedKey = z.infer<typeof CreatedKey>
export type RevokedKeys = z.infer<typeof RevokedKeys>
