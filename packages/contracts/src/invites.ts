import { z } from "@hono/zod-openapi"
import { orgId } from "./orgs"

export const profileColours = ["zinc", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const
export type ProfileColour = (typeof profileColours)[number]
export const inviteLimits = { days: 7, aboutChars: 280, displayNameChars: 60 } as const
export const inviteStates = ["open", "accepted", "revoked", "expired"] as const

const memberName = z.string().regex(/^[a-z][a-z0-9-]*$/)

export const CreateInviteBody = z
  .object({
    email: z.email().trim().toLowerCase().openapi({ example: "ana@acme.example" }),
    name: memberName.openapi({ example: "ana", description: "The member name they get" }),
    org: orgId.openapi({ example: "acme", description: "The org they join" }),
  })
  .openapi("CreateInviteBody")

export const Invite = z
  .object({
    id: z.number().int(),
    email: z.string(),
    name: z.string(),
    org: z.string(),
    invitedBy: z.string(),
    state: z.enum(inviteStates),
    expiresAt: z.string().openapi({ format: "date-time" }),
    at: z.string().openapi({ format: "date-time" }),
  })
  .openapi("Invite")

export const InviteParams = z.object({ id: z.coerce.number().int().openapi({ type: "integer", param: { name: "id", in: "path", required: true }, example: 3 }) })

export const UpdateProfileBody = z
  .object({
    displayName: z.string().trim().min(1).max(inviteLimits.displayNameChars).nullable().optional().openapi({ example: "Ana from Acme" }),
    about: z.string().trim().min(1).max(inviteLimits.aboutChars).nullable().optional().openapi({ example: "Runs the Acme site" }),
    colour: z.enum(profileColours).nullable().optional(),
  })
  .refine((body) => body.displayName !== undefined || body.about !== undefined || body.colour !== undefined, "Give displayName, about or colour")
  .openapi("UpdateProfileBody")

export type CreateInviteBody = z.infer<typeof CreateInviteBody>
export type Invite = z.infer<typeof Invite>
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>
