import { z } from "@hono/zod-openapi"

export const accessLevels = ["read", "reply", "full", "custom"] as const
export type AccessLevel = (typeof accessLevels)[number]

export const accessGrants = ["reply", "work", "manage"] as const
export type AccessGrant = (typeof accessGrants)[number]

export const accessLevelLabels = { read: "Read only", reply: "Read and reply", full: "Full", custom: "Custom" } as const satisfies Record<AccessLevel, string>

export const accessGrantLabels = {
  reply: "Post, reply, react and ask in threads",
  work: "Tasks, plans, notes, memory and the channel document",
  manage: "Channels, members, agents, keys, invites and settings",
} as const satisfies Record<AccessGrant, string>

const fixedGrants = { read: [], reply: ["reply"], full: accessGrants } as const satisfies Record<Exclude<AccessLevel, "custom">, readonly AccessGrant[]>

export function grantsOf(level: AccessLevel, custom: readonly AccessGrant[] | null): AccessGrant[] {
  if (level === "custom") return accessGrants.filter((grant) => custom?.includes(grant))
  return [...fixedGrants[level]]
}

export const accessEventTypes = { changed: "agent.access_changed" } as const

export const AccessLevelSchema = z.enum(accessLevels).openapi("AccessLevel", {
  description: "read: reads only. reply: reads, posts and replies. full: everything its member kind may do. custom: reads plus the grants picked",
})
export const AccessGrantSchema = z.enum(accessGrants).openapi("AccessGrant", {
  description: "reply: post, reply, react, ask and answer in threads. work: tasks, plans, notes, memory, areas, the channel document. manage: channels, members, agents, keys, invites, routines and settings",
})

export const SetAccessBody = z
  .object({
    level: AccessLevelSchema,
    grants: z.array(AccessGrantSchema).max(accessGrants.length).optional().openapi({ description: "Only with level custom: what it may do beyond reading", example: ["reply", "work"] }),
  })
  .openapi("SetAccessBody")

export const MemberAccess = z
  .object({
    name: z.string().openapi({ example: "acme-bot" }),
    level: AccessLevelSchema,
    grants: z.array(AccessGrantSchema).openapi({ description: "What the member may do beyond reading, worked out from its level" }),
  })
  .openapi("MemberAccess")

export type SetAccessBody = z.infer<typeof SetAccessBody>
export type MemberAccess = z.infer<typeof MemberAccess>
