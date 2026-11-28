import { z } from "@hono/zod-openapi"
import { channelVisibilities } from "./constants"

export const ChannelVisibility = z.enum(channelVisibilities).openapi("ChannelVisibility", {
  description: "org: everyone in the owning org; private: only the channel's listed members; shared: everyone in the owning org plus listed members of other orgs",
})

export const orgId = z.string().regex(/^[a-z][a-z0-9-]*$/)

export const Org = z
  .object({
    id: orgId.openapi({ example: "acme" }),
    name: z.string().openapi({ example: "Acme" }),
    host: z.boolean().openapi({ description: "True for the org that runs the board; board-wide settings belong to it" }),
  })
  .openapi("Org")

export const CreateOrgBody = z.object({ id: orgId.openapi({ example: "acme" }), name: z.string().trim().min(1).max(80).openapi({ example: "Acme" }) }).openapi("CreateOrgBody")

export const ChannelMember = z
  .object({
    member: z.string().openapi({ example: "ana" }),
    org: z.string().openapi({ example: "acme" }),
    addedBy: z.string().nullable(),
    addedAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("ChannelMember")

export const ChannelMemberParams = z.object({
  channel: z.string().openapi({ param: { name: "channel", in: "path" }, example: "acme-site" }),
  name: z.string().openapi({ param: { name: "name", in: "path" }, example: "ana" }),
})

export const mayJoinChannel = (channel: { org: string; visibility: ChannelVisibility }, member: { org: string }): boolean =>
  member.org === channel.org || channel.visibility === "shared"

export type ChannelVisibility = z.infer<typeof ChannelVisibility>
export type Org = z.infer<typeof Org>
export type CreateOrgBody = z.infer<typeof CreateOrgBody>
export type ChannelMember = z.infer<typeof ChannelMember>
