import { defaultMember, memberHeader } from "@flockr/contracts/constants"
import { createClient, type Client } from "./gen/client"
import { client } from "./gen/client.gen"

export * from "./gen"
export { client } from "./gen/client.gen"
export type { Client } from "./gen/client"
export { connectLive, liveUrl, type LiveConnection, type LiveOptions } from "./live"
export { activitySeconds, defaultMember, errorKinds, leaseMinutes, memberHeader, memberKinds, taskStates } from "@flockr/contracts/constants"
export { mayDeleteMessage, mayManageAgent, mentionsIn, type MessageDeleteCheck } from "@flockr/contracts/rules"
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

export function configureClient(options: { baseUrl: string; member?: string }): void {
  client.setConfig({ baseUrl: options.baseUrl, headers: { [memberHeader]: options.member ?? defaultMember } })
}

export function memberClient(options: { baseUrl: string; member?: string }): Client {
  return createClient({ baseUrl: options.baseUrl, headers: { [memberHeader]: options.member ?? defaultMember } })
}
