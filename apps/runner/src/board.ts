import * as sdk from "@flockr/client"
import { callTimeoutMs } from "./config"
import type { MemoryContext } from "./memory"
import type { ActionKind, ActivityUpdate, Agent, AgentDetail, ApprovalVerdict, Client, CreateAgentBody, HeartbeatBody, OpenSessionBody, RegisterMachineBody, RunEndStatus, SavedSession, SaveChunkBody, Task, TaskState, Thread, ThreadQuestion } from "@flockr/client"

export type AskResult = { kind: "asked"; question: ThreadQuestion } | { kind: "refused"; reason: string }

export interface BoardPort {
  me: () => Promise<{ org: string } | null>
  task: (id: number) => Promise<Task>
  tasks: (query: { assignee?: string; member?: string; reviewer?: string; state?: TaskState }) => Promise<Task[]>
  thread: (id: string) => Promise<Thread>
  people: () => Promise<Set<string>>
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
  memory: (channel: string) => Promise<MemoryContext>
}

export interface Claim {
  taskId: number
  epoch: number
}

export class BoardFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: string | null = null,
  ) {
    super(message)
  }
}

type Result<T> = ({ data: T; error: undefined } | { data: undefined; error: unknown }) & { response?: Response }

function kindOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "kind" in error && typeof error.kind === "string" ? error.kind : null
}

function messageOf(error: unknown, status: number): string {
  if (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string") return error.error
  return `HTTP ${status}`
}

export async function call<T>(promise: Promise<Result<T>>): Promise<NonNullable<T>> {
  const result = await promise
  const data = result.data
  const status = result.response?.status ?? 0
  if (result.error !== undefined || data === undefined || data === null) throw new BoardFailure(status, messageOf(result.error, status), kindOf(result.error))
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
    async me() {
      return (await call(sdk.whoami(on()))).member
    },
    task: (id) => call(sdk.getTask({ ...on(), path: { id } })),
    tasks: (query) => call(sdk.listTasks({ ...on(), query })),
    thread: (id) => call(sdk.getThread({ ...on(), path: { id } })),
    people: async () => new Set((await call(sdk.listMembers(on()))).filter((m) => m.kind === "person").map((m) => m.name)),
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
    async memory(channel) {
      const [notes, shared, document] = await Promise.all([
        call(sdk.listAgentNotes({ ...on(), path: { name: member }, query: { state: "active" } })),
        call(sdk.listChannelMemory({ ...on(), path: { channel }, query: { state: "active" } })),
        call(sdk.getChannelDocument({ ...on(), path: { channel } })),
      ])
      return { notes, channel: shared, document }
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

export type ChunkSaved = { kind: "saved" } | { kind: "stale"; reason: string } | { kind: "conflict"; reason: string }

export interface SessionsPort {
  open: (session: string, body: OpenSessionBody) => Promise<SavedSession>
  save: (session: string, body: SaveChunkBody) => Promise<ChunkSaved>
  chunk: (session: string, turn: number) => Promise<Uint8Array>
  latest: (thread: string) => Promise<string | null>
}

const refusals = { stale_claim: "stale", already_exists: "conflict", wrong_state: "conflict" } as const satisfies Record<string, ChunkSaved["kind"]>

const refusalOf = (kind: string | null): "stale" | "conflict" | null => Object.entries(refusals).find(([known]) => known === kind)?.[1] ?? null

export function sessionsClient(options: { member: string; client: Client }): SessionsPort {
  const on = () => ({ client: options.client, signal: AbortSignal.timeout(callTimeoutMs) })
  const at = (session: string) => ({ name: options.member, session })
  return {
    open: (session, body) => call(sdk.openSavedSession({ ...on(), path: at(session), body })),
    async save(session, body) {
      try {
        await call(sdk.saveSessionChunk({ ...on(), path: at(session), body }))
        return { kind: "saved" }
      } catch (error) {
        const refusal = error instanceof BoardFailure && error.status === conflict ? refusalOf(error.kind) : null
        if (refusal) return { kind: refusal, reason: error instanceof Error ? error.message : String(error) }
        throw error
      }
    },
    chunk: async (session, turn) => Uint8Array.from(Buffer.from((await call(sdk.readSessionChunk({ ...on(), path: { ...at(session), turn } }))).data, "base64")),
    latest: async (thread) => (await call(sdk.listSavedSessions({ ...on(), path: { name: options.member }, query: { thread, limit: 1 } })))[0]?.session ?? null,
  }
}
