import { z } from "@hono/zod-openapi"

export const chatBridges = ["slack"] as const
export type ChatBridgeName = (typeof chatBridges)[number]

export const bridgedEventTypes = [
  "message.posted",
  "reply.posted",
  "task.created",
  "task.asked",
  "question.asked",
  "task.submitted",
  "task.answered",
  "question.answered",
  "task.approved",
  "task.changes_requested",
] as const
export type BridgedEventType = (typeof bridgedEventTypes)[number]

export const bridgeEventTypes = {
  channelLinked: "bridge.channel_linked",
  channelUnlinked: "bridge.channel_unlinked",
  personLinked: "bridge.person_linked",
  personUnlinked: "bridge.person_unlinked",
} as const

export const bridgeLimits = { externalChars: 64, textChars: 3000, buttons: 5 } as const

export const BridgeChannelLink = z
  .object({
    channel: z.string().openapi({ example: "backend" }),
    external: z.string().openapi({ example: "C07ABC123", description: "The chat platform's channel id" }),
    linkedBy: z.string().openapi({ example: "simon" }),
    linkedAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("BridgeChannelLink")

export const BridgePersonLink = z
  .object({
    member: z.string().openapi({ example: "simon" }),
    external: z.string().openapi({ example: "U07ABC123", description: "The chat platform's user id" }),
    linkedAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("BridgePersonLink")

export const Bridge = z
  .object({
    name: z.enum(chatBridges),
    label: z.string().openapi({ example: "Slack" }),
    enabled: z.boolean().openapi({ description: "Whether the server has this bridge's secrets; nothing syncs until it does and a channel is linked" }),
    channels: z.array(BridgeChannelLink).openapi({ description: "Linked channels you can see" }),
    people: z.array(BridgePersonLink).openapi({ description: "People linked to a user on the platform; host-org people only" }),
    me: z.string().nullable().openapi({ description: "Your own platform user id, if you linked one" }),
  })
  .openapi("Bridge")

export const BridgeList = z.object({ bridges: z.array(Bridge) }).openapi("BridgeList")

export const BridgeParams = z.object({
  bridge: z.enum(chatBridges).openapi({ param: { name: "bridge", in: "path" }, example: "slack" }),
})

export const BridgeChannelParams = BridgeParams.extend({
  channel: z.string().openapi({ param: { name: "channel", in: "path" }, example: "backend" }),
})

export const LinkBridgeBody = z
  .object({ external: z.string().trim().min(1).max(bridgeLimits.externalChars).openapi({ example: "C07ABC123", description: "The platform's channel or user id" }) })
  .openapi("LinkBridgeBody")

export type Bridge = z.infer<typeof Bridge>
export type BridgeList = z.infer<typeof BridgeList>
export type BridgeChannelLink = z.infer<typeof BridgeChannelLink>
export type BridgePersonLink = z.infer<typeof BridgePersonLink>
export type LinkBridgeBody = z.infer<typeof LinkBridgeBody>
