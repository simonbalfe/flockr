import { z } from "@hono/zod-openapi"

export const agentPermissions = ["edit-free-commands-ask", "read-only"] as const
export type AgentPermissions = (typeof agentPermissions)[number]
export const defaultAgentPermissions: AgentPermissions = "edit-free-commands-ask"

export const permissionLabels = {
  "edit-free-commands-ask": { label: "Edits free, commands ask", explanation: "Reads and edits files in its folder without asking. Any other command becomes a question a person answers." },
  "read-only": { label: "Read only", explanation: "Reads files but never edits them. Any command becomes a question a person answers." },
} as const satisfies Record<AgentPermissions, { label: string; explanation: string }>

export const agentStatuses = ["offline", "online", "working", "error"] as const
export type AgentStatus = (typeof agentStatuses)[number]

export const agentStatusLabels = { offline: "Offline", online: "Online", working: "Working", error: "Error" } as const satisfies Record<AgentStatus, string>

export const agentDesiredStates = ["running", "stopped"] as const
export type AgentDesired = (typeof agentDesiredStates)[number]

export const agentReports = ["serving", "working", "error"] as const
export type AgentReport = (typeof agentReports)[number]

export const agentEventTypes = {
  created: "agent.created",
  updated: "agent.updated",
  started: "agent.started",
  stopped: "agent.stopped",
  deleted: "agent.deleted",
} as const

export const machineLimits = { heartbeatSeconds: 15, onlineSeconds: 45 } as const
export const agentLimits = { nameMin: 2, nameMax: 32, personalityMax: 4000, reasonMax: 300, modelMax: 200, recentRuns: 5, recentRunsMax: 20 } as const

export const runnerCommand = "bun run runner"

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-24T10:40:02.000Z" })

export const AgentPermissionsSchema = z.enum(agentPermissions).openapi("AgentPermissions", {
  description: "edit-free-commands-ask: reads and edits are free, other commands become a question card. read-only: reads are free, edits are refused, commands ask.",
})
export const AgentStatusSchema = z.enum(agentStatuses).openapi("AgentStatus", {
  description: "offline: stopped or its machine is offline. online: served and idle. working: a run is active. error: the runner could not serve it (see statusReason).",
})
export const AgentDesiredSchema = z.enum(agentDesiredStates).openapi("AgentDesired")
export const AgentReportSchema = z.enum(agentReports).openapi("AgentReport")

export const agentNamePattern = /^[a-z][a-z0-9-]+$/

export const AgentName = z
  .string()
  .min(agentLimits.nameMin)
  .max(agentLimits.nameMax)
  .regex(agentNamePattern, { error: "Use lowercase letters, digits and dashes, starting with a letter" })
  .openapi({ example: "scout" })

export const AbsoluteFolder = z.string().trim().regex(/^\//, { error: "The folder must be an absolute path" }).openapi({ example: "/Users/dana/code/shop" })

const Personality = z.string().trim().max(agentLimits.personalityMax).openapi({ description: "Extra system text the agent gets, such as its role or tone" })

const ModelId = z
  .string()
  .trim()
  .max(agentLimits.modelMax)
  .openapi({ description: "A model id the agent's harness passes to its model provider; null or empty uses the runner's default. Harnesses that pick their own model ignore it" })

export const HarnessInfo = z
  .object({
    id: z.string().min(1).openapi({ example: "local-agent" }),
    label: z.string().min(1).openapi({ description: "The name people see, as the runner reports it" }),
    capabilities: z.record(z.string(), z.boolean()).openapi({ description: "What the harness adapter declares, such as resume and streaming" }),
  })
  .openapi("HarnessInfo")

export const MachineId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
  .openapi({ example: "danas-laptop" })

export const Machine = z
  .object({
    id: MachineId,
    name: z.string(),
    harnesses: z.array(HarnessInfo),
    online: z.boolean().openapi({ description: `True while the last heartbeat is under ${machineLimits.onlineSeconds} seconds old` }),
    lastSeenAt: timestamp,
  })
  .openapi("Machine")

export const AgentConfig = z
  .object({
    harness: z.string().openapi({ description: "A harness id as the machine reports it" }),
    harnessLabel: z.string().nullable().openapi({ description: "The machine's label for the harness, or null if the machine no longer reports it" }),
    folder: z.string(),
    machine: MachineId,
    machineName: z.string(),
    permissions: AgentPermissionsSchema,
    personality: z.string().nullable(),
    model: z.string().nullable(),
    desired: AgentDesiredSchema,
  })
  .openapi("AgentConfig")

export const MachineParams = z.object({ id: MachineId.openapi({ param: { name: "id", in: "path" } }) })
export const AgentParams = z.object({ name: z.string().openapi({ param: { name: "name", in: "path" }, example: "scout" }) })

export const RegisterMachineBody = z
  .object({
    id: MachineId,
    name: z.string().trim().min(1).max(100),
    harnesses: z.array(HarnessInfo).openapi({ description: "The harnesses this machine can run right now" }),
  })
  .openapi("RegisterMachineBody")

export const AgentReportEntry = z
  .object({
    name: z.string(),
    state: AgentReportSchema,
    reason: z.string().max(agentLimits.reasonMax).nullable().default(null).openapi({ description: "A short reason when state is error, such as a missing folder" }),
  })
  .openapi("AgentReportEntry")

export const HeartbeatBody = z
  .object({
    harnesses: z.array(HarnessInfo).optional().openapi({ description: "Send when the harnesses this machine can run changed" }),
    agents: z.array(AgentReportEntry).default([]).openapi({ description: "Every agent this machine serves right now; an agent left out is not served" }),
  })
  .openapi("HeartbeatBody")

export const CreateAgentBody = z
  .object({
    name: AgentName,
    harness: z.string().min(1).openapi({ description: "A harness id the machine reports (listMachines)" }),
    folder: AbsoluteFolder,
    machine: MachineId.openapi({ description: "The machine whose runner serves the agent" }),
    permissions: AgentPermissionsSchema.default(defaultAgentPermissions),
    personality: Personality.nullable().default(null),
    model: ModelId.nullable().default(null),
  })
  .openapi("CreateAgentBody")

export const UpdateAgentBody = z
  .object({
    folder: AbsoluteFolder.optional(),
    permissions: AgentPermissionsSchema.optional(),
    personality: Personality.nullable().optional().openapi({ description: "Send null or an empty string to clear it" }),
    model: ModelId.nullable().optional().openapi({ description: "Send null or an empty string to use the runner's default" }),
  })
  .refine((body) => body.folder !== undefined || body.permissions !== undefined || body.personality !== undefined || body.model !== undefined, {
    error: "Change at least one of folder, permissions, personality or model",
  })
  .openapi("UpdateAgentBody")

export const AgentActivityQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(agentLimits.recentRunsMax)
    .default(agentLimits.recentRuns)
    .openapi({ type: "integer", description: `At most this many entries, newest first; default ${agentLimits.recentRuns}, at most ${agentLimits.recentRunsMax}` }),
})

export const DeletedAgent = z.object({ name: z.string(), removedAt: timestamp }).openapi("DeletedAgent")

export type HarnessInfo = z.infer<typeof HarnessInfo>
export type Machine = z.infer<typeof Machine>
export type AgentConfig = z.infer<typeof AgentConfig>
export type RegisterMachineBody = z.infer<typeof RegisterMachineBody>
export type AgentReportEntry = z.infer<typeof AgentReportEntry>
export type HeartbeatBody = z.infer<typeof HeartbeatBody>
export type CreateAgentBody = z.infer<typeof CreateAgentBody>
export type UpdateAgentBody = z.infer<typeof UpdateAgentBody>
export type DeletedAgent = z.infer<typeof DeletedAgent>
export type AgentActivityQuery = z.infer<typeof AgentActivityQuery>
