import * as sdk from "@flockr/client"
import { callTimeoutMs } from "./config"
import type { ActionKind, ActivityUpdate, Agent, AgentDetail, ApprovalVerdict, Client, CreateAgentBody, HeartbeatBody, RegisterMachineBody, RunEndStatus, Task, TaskState, Thread, ThreadQuestion } from "@flockr/client"

export type AskResult = { kind: "asked"; question: ThreadQuestion } | { kind: "refused"; reason: string }

export interface BoardPort {
  isMember: () => Promise<boolean>
  task: (id: number) => Promise<Task>
  tasks: (query: { assignee?: string; member?: string; state?: TaskState }) => Promise<Task[]>
  thread: (id: string) => Promise<Thread>
  claim: (id: number) => Promise<Task | null>
  renew: (claim: Claim) => Promise<boolean>
  release: (claim: Claim, keepAssignee: boolean) => Promise<boolean>
  submit: (claim: Claim, note: string) => Promise<boolean>
  block: (claim: Claim, reason: string) => Promise<boolean>
  reply: (thread: string, text: string) => Promise<void>
  startEntry: (thread: string, entry: { title: string; runId: string; key: string }) => Promise<string>
  updateEntry: (entryId: string, updates: ActivityUpdate[]) => Promise<void>
  finishEntry: (entryId: string, status: RunEndStatus) => Promise<void>
  ask: (thread: string, question: { text: string; detail: string; options: string[] }) => Promise<AskResult>
  approval: (kind: ActionKind, channel: string) => Promise<ApprovalVerdict>
}

export interface Claim {
  taskId: number
  epoch: number
}

export class BoardFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type Result<T> = ({ data: T; error: undefined } | { data: undefined; error: unknown }) & { response?: Response }

function messageOf(error: unknown, status: number): string {
  if (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string") return error.error
  return `HTTP ${status}`
}

export async function call<T>(promise: Promise<Result<T>>): Promise<NonNullable<T>> {
  const result = await promise
  const data = result.data
  const status = result.response?.status ?? 0
  if (result.error !== undefined || data === undefined || data === null) throw new BoardFailure(status, messageOf(result.error, status))
  return data
}

const conflict = 409

async function unlessConflict(work: Promise<unknown>): Promise<boolean> {
  try {
    await work
    return true
  } catch (error) {
    if (error instanceof BoardFailure && error.status === conflict) return false
    throw error
  }
}

export function boardClient(options: { member: string; client: Client }): BoardPort {
  const { member } = options
  const on = () => ({ client: options.client, signal: AbortSignal.timeout(callTimeoutMs) })
  return {
    async isMember() {
      return (await call(sdk.whoami(on()))).member !== null
    },
    task: (id) => call(sdk.getTask({ ...on(), path: { id } })),
    tasks: (query) => call(sdk.listTasks({ ...on(), query })),
    thread: (id) => call(sdk.getThread({ ...on(), path: { id } })),
    async claim(id) {
      try {
        return await call(sdk.claimTask({ ...on(), path: { id } }))
      } catch (error) {
        if (error instanceof BoardFailure && error.status === conflict) return null
        throw error
      }
    },
    renew: (claim) => unlessConflict(call(sdk.renewTask({ ...on(), path: { id: claim.taskId }, body: { epoch: claim.epoch } }))),
    release: (claim, keepAssignee) => unlessConflict(call(sdk.releaseTask({ ...on(), path: { id: claim.taskId }, body: { epoch: claim.epoch, keepAssignee } }))),
    submit: (claim, note) => unlessConflict(call(sdk.submitForReview({ ...on(), path: { id: claim.taskId }, body: { epoch: claim.epoch, note } }))),
    block: (claim, reason) => unlessConflict(call(sdk.blockTask({ ...on(), path: { id: claim.taskId }, body: { epoch: claim.epoch, reason } }))),
    async reply(thread, text) {
      await call(sdk.replyToThread({ ...on(), path: { id: thread }, body: { text } }))
    },
    async startEntry(thread, entry) {
      return (await call(sdk.createActivityEntry({ ...on(), path: { id: thread }, body: { ...entry, parts: [] } }))).entry.id
    },
    async updateEntry(entryId, updates) {
      await call(sdk.updateActivityEntry({ ...on(), path: { id: entryId }, body: { updates } }))
    },
    async finishEntry(entryId, status) {
      await call(sdk.updateActivityEntry({ ...on(), path: { id: entryId }, body: { updates: [{ type: "run.finished", status }] } }))
    },
    async ask(thread, question) {
      try {
        return { kind: "asked", question: await call(sdk.askInThread({ ...on(), path: { id: thread }, body: question })) }
      } catch (error) {
        if (error instanceof BoardFailure) return { kind: "refused", reason: `${member} could not ask in ${thread}: ${error.message}` }
        throw error
      }
    },
    async approval(kind, channel) {
      try {
        return (await call(sdk.checkApproval({ ...on(), query: { kind, channel } }))).verdict
      } catch (error) {
        if (error instanceof BoardFailure) return "ask"
        throw error
      }
    },
  }
}

export interface MachinePort {
  register: (body: RegisterMachineBody) => Promise<void>
  heartbeat: (id: string, body: HeartbeatBody) => Promise<Agent[]>
  agent: (name: string) => Promise<AgentDetail | null>
  createAgent: (asMember: string, body: CreateAgentBody) => Promise<AgentDetail>
}

const notFound = 404

export function machineClient(options: { client: Client; forMember: (member: string) => Client }): MachinePort {
  const on = () => ({ client: options.client, signal: AbortSignal.timeout(callTimeoutMs) })
  return {
    async register(body) {
      await call(sdk.registerMachine({ ...on(), body }))
    },
    heartbeat: async (id, body) => (await call(sdk.machineHeartbeat({ ...on(), path: { id }, body }))).agents,
    async agent(name) {
      try {
        return await call(sdk.getAgent({ ...on(), path: { name } }))
      } catch (error) {
        if (error instanceof BoardFailure && error.status === notFound) return null
        throw error
      }
    },
    createAgent: (asMember, body) => call(sdk.createAgent({ client: options.forMember(asMember), body, signal: AbortSignal.timeout(callTimeoutMs) })),
  }
}
