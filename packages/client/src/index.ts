import { defaultMember, memberHeader } from "@flockr/contracts/constants"
import { createClient, type Client } from "./gen/client"
import { client } from "./gen/client.gen"

export * from "./gen"
export { client } from "./gen/client.gen"
export type { Client } from "./gen/client"
export { connectLive, liveUrl, type LiveConnection, type LiveOptions } from "./live"
export { activitySeconds, defaultMember, errorKinds, leaseMinutes, memberHeader, memberKinds, messageLimits, taskStates } from "@flockr/contracts/constants"
export {
  labelSet,
  mayDeleteMessage,
  mayEditMessage,
  mayLabelMessage,
  mayManageAgent,
  mayManageApprovalRules,
  mayManageRoutine,
  mentionsIn,
  sameLabels,
  splitSubThreads,
  type MessageDeleteCheck,
  type SubThreads,
} from "@flockr/contracts/rules"
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

export function configureClient(options: { baseUrl: string; member?: string }): void {
  client.setConfig({ baseUrl: options.baseUrl, headers: { [memberHeader]: options.member ?? defaultMember } })
}

export function memberClient(options: { baseUrl: string; member?: string }): Client {
  return createClient({ baseUrl: options.baseUrl, headers: { [memberHeader]: options.member ?? defaultMember } })
}
