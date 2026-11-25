import { authorizationHeader, bearerAuth, defaultMember, memberHeader } from "@flockr/contracts/constants"
import { createClient, type Client } from "./gen/client"
import { client } from "./gen/client.gen"

export * from "./gen"
export { client } from "./gen/client.gen"
export type { Client } from "./gen/client"
export { connectLive, liveUrl, type LiveConnection, type LiveOptions } from "./live"
export { authBasePath, keyLimits, signInWording } from "@flockr/contracts/auth"
export { activitySeconds, authorizationHeader, bearerAuth, defaultMember, errorKinds, leaseMinutes, memberHeader, memberKinds, messageLimits, taskStates } from "@flockr/contracts/constants"
export {
  labelSet,
  mayDeleteMessage,
  mayEditMessage,
  mayLabelMessage,
  mayManageAgent,
  mayManageApprovalRules,
  mayManageKeys,
  mayManageRoutine,
  mentionsIn,
  sameLabels,
  splitSubThreads,
  type MessageDeleteCheck,
  type SubThreads,
} from "@flockr/contracts/rules"
export {
  mayChangeChannelMemory,
  mayUseAgentNotes,
  memoryEventTypes,
  memoryItemCap,
  memoryKindLabels,
  memoryKindOrder,
  memoryKinds,
  memoryLimits,
  memoryScopes,
} from "@flockr/contracts/memory"
export { nextRunOf, parseCron } from "@flockr/contracts/cron"
export {
  backoffSeconds,
  jobLimits,
  jobStateLabels,
  jobStates,
  routineActionKinds,
  routineActionLabels,
  routineActor,
  routineLimits,
  routineTriggerKinds,
  routineTriggerLabels,
  watchableEventTypes,
} from "@flockr/contracts/routines"
export { checklistLabel, doneTasksByRow, parseChecklist, tickChecklist, type ChecklistRow, type Ticked } from "@flockr/contracts/checklist"
export {
  agentEventTypes,
  agentLimits,
  agentNamePattern,
  agentPermissions,
  agentStatuses,
  agentStatusLabels,
  defaultAgentPermissions,
  machineLimits,
  permissionLabels,
  runnerCommand,
} from "@flockr/contracts/agents"
export { agentPresets, leadPreset, presetOf, type AgentPreset } from "@flockr/contracts/presets"
export {
  activityEventTypes,
  activityLimits,
  activityPartTypes,
  applyActivityUpdates,
  currentStep,
  diffLines,
  filesFromDiff,
  framesFromStack,
  partHeadline,
  planStepStatuses,
  runStatuses,
  stepStatuses,
} from "@flockr/contracts/activity-rules"
export {
  actionKindRules,
  actionKinds,
  allowedVerdicts,
  approvalOptions,
  approvalVerdictLabels,
  approvalVerdicts,
  effectiveVerdict,
  stricterVerdict,
  verdictAllowed,
} from "@flockr/contracts/approvals"

export interface ClientOptions {
  baseUrl: string
  member?: string
  key?: string | null
}

export function clientHeaders(options: Omit<ClientOptions, "baseUrl">): Record<string, string> {
  return { [memberHeader]: options.member ?? defaultMember, ...(options.key ? { [authorizationHeader]: bearerAuth(options.key) } : {}) }
}

export function configureClient(options: ClientOptions): void {
  client.setConfig({ baseUrl: options.baseUrl, headers: clientHeaders(options) })
}

export function memberClient(options: ClientOptions): Client {
  return createClient({ baseUrl: options.baseUrl, headers: clientHeaders(options) })
}
