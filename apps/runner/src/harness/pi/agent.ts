import { createHash } from "node:crypto"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Message, Models } from "@earendil-works/pi-ai"
import {
  AssistantEntry,
  createRegistry,
  defineDoc,
  Harness,
  type Conversation,
  type ConversationId,
  type HarnessSettings,
  type ModelRef,
  type SettledSubmissionRecord,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node"
import type { PiBoard } from "./board"
import { openAgentStorage } from "./sqlite"
import { alreadyPosted, boardExtension, filesExtension, keptPosted, ThreadDoc, triggerOf, type TurnRecord } from "./tools"

const context = BACKGROUND_CONTEXT

const ThreadsDoc = defineDoc<{ byThread: Record<string, ConversationId> }>({
  kind: "flockr.threads",
  version: 1,
  scope: "session",
  initial: () => ({ byThread: {} }),
  checkpointWhen: () => true,
})

export const defaultAgentSettings: HarnessSettings = {
  restartLimit: 3,
  retry: { maxRetries: 2 },
  afterFailedRun: "continue",
}

export interface TurnSettings {
  model: ModelRef | null
  instructions: string
  folder: string | null
  fileTools: readonly ToolRegistration[]
  maxTurns: number
}

export type TurnOutcome = { kind: "answered"; text: string } | { kind: "unanswered"; reason: string; aborted: boolean }

export interface AgentHomeOptions {
  file: string
  member: string
  board: PiBoard
  models: Models
  log: (line: string) => void
  settings?: HarnessSettings
  failedText: (reason: string) => string
}

export const requestIdFor = (options: { thread: string; messageId: string | null; prompt: string }): string =>
  options.messageId === null ? `prompt-${createHash("sha256").update(`${options.thread}\n${options.prompt}`).digest("hex").slice(0, 32)}` : `msg-${options.messageId}`

function answerText(model: readonly Message[] | undefined): string {
  const message = model?.[0]
  if (message?.role !== "assistant") return ""
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
}

function reasonOf(record: SettledSubmissionRecord): string {
  const detail = typeof record.detail === "string" ? `: ${record.detail}` : ""
  return `${record.reason ?? "no answer"}${detail}`.slice(0, 300)
}

export class AgentHome {
  private readonly opening = new Map<string, Promise<Conversation>>()
  private readonly settling = new Map<string, Promise<TurnOutcome>>()
  private readonly boardTools: readonly ToolRegistration[]

  private constructor(
    private readonly harness: Harness,
    private readonly options: AgentHomeOptions,
    board: ReturnType<typeof boardExtension>,
  ) {
    this.boardTools = board.tools ?? []
  }

  static async open(options: AgentHomeOptions): Promise<AgentHome> {
    const registry = createRegistry()
    const board = boardExtension({ member: options.member, board: options.board, log: options.log })
    registry.install(board)
    registry.install(filesExtension)
    const harness = await Harness.open(
      await openAgentStorage(options.file),
      {
        models: options.models,
        registry,
        identity: { attribution: null },
        env: ({ cwd }) => (cwd ? new NodeExecutionEnv({ cwd }) : undefined),
        settings: options.settings ?? defaultAgentSettings,
        onReport: (report) => options.log(`${options.member}: ${report.kind}`),
      },
      context,
    )
    harness.resume()
    return new AgentHome(harness, options, board)
  }

  get toolNames(): string[] {
    return this.boardTools.map((t) => t.name)
  }

  async offeredTools(thread: string): Promise<string[]> {
    const conversation = await this.conversationFor(thread)
    return (await conversation.agent(context)).tools.map((t) => t.name)
  }

  private conversationFor(thread: string): Promise<Conversation> {
    const open = this.opening.get(thread) ?? this.findOrCreate(thread)
    this.opening.set(thread, open)
    open.catch(() => this.opening.delete(thread))
    return open
  }

  private async findOrCreate(thread: string): Promise<Conversation> {
    const known = (await this.harness.snapshot(ThreadsDoc, context))?.byThread[thread]
    const existing = known === undefined ? undefined : await this.harness.conversation(known, context)
    if (existing) return existing
    return this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          ;(await tx.doc(ThreadsDoc)).byThread[thread] = id
          ;(await tx.doc(ThreadDoc, id)).thread = thread
        },
      },
      context,
    )
  }

  async turn(options: { thread: string; prompt: string; settings: TurnSettings }): Promise<TurnOutcome> {
    const { thread, prompt, settings } = options
    if (!settings.model) return { kind: "unanswered", reason: "no model is set for this agent", aborted: false }
    const current = await this.options.board.thread(thread)
    const messageId = triggerOf({ thread: current, member: this.options.member, text: prompt })
    const requestId = requestIdFor({ thread, messageId, prompt })
    const conversation = await this.conversationFor(thread)
    await conversation.configure(
      { model: settings.model, instructions: settings.instructions, cwd: settings.folder, tools: [...this.boardTools, ...(settings.folder ? settings.fileTools : [])], maxTurns: settings.maxTurns },
      context,
    )
    const turn = await conversation.commit(async (tx) => {
      const submissionId = await conversation.submit(tx, { type: "input", content: prompt, requestId, whenBusy: "followUp" })
      const state = await tx.doc(ThreadDoc, conversation.id)
      state.thread = thread
      state.folder = settings.folder
      const record: TurnRecord = { requestId, messageId, submissionId }
      if (!state.pending.some((p) => p.requestId === requestId) && !state.posted.includes(requestId)) state.pending.push(record)
      return record
    }, context)
    return this.settle({ thread, conversation, turn, announce: false })
  }

  private settle(options: { thread: string; conversation: Conversation; turn: TurnRecord; announce: boolean }): Promise<TurnOutcome> {
    const key = `${options.conversation.id}:${options.turn.requestId}`
    const running = this.settling.get(key)
    if (running) return running
    const work = this.deliver(options).finally(() => this.settling.delete(key))
    this.settling.set(key, work)
    return work
  }

  private async deliver(options: { thread: string; conversation: Conversation; turn: TurnRecord; announce: boolean }): Promise<TurnOutcome> {
    const { thread, conversation, turn } = options
    const submission = await this.harness.submission(turn.submissionId, context)
    const record = submission ? await submission.wait(context) : null
    const outcome = record ? await this.outcomeOf(conversation, record) : { kind: "unanswered" as const, reason: "the turn was lost", aborted: false }
    const text = this.replyFor(outcome, options.announce)
    if (text) {
      const state = await this.harness.snapshot(ThreadDoc, conversation.id, context)
      if (!state?.posted.includes(turn.requestId)) {
        const current = await this.options.board.thread(thread)
        if (!alreadyPosted({ thread: current, member: this.options.member, after: turn.messageId, text })) await this.options.board.reply(thread, text)
      }
    }
    await conversation.commit(async (tx) => {
      const state = await tx.doc(ThreadDoc, conversation.id)
      state.pending = state.pending.filter((p) => p.requestId !== turn.requestId)
      if (!state.posted.includes(turn.requestId)) state.posted = [...state.posted, turn.requestId].slice(-keptPosted)
    }, context)
    return outcome
  }

  private replyFor(outcome: TurnOutcome, announce: boolean): string {
    switch (outcome.kind) {
      case "answered":
        return outcome.text.trim()
      case "unanswered":
        return announce && !outcome.aborted ? this.options.failedText(outcome.reason) : ""
      default: {
        const never: never = outcome
        throw new Error(`Unknown outcome ${JSON.stringify(never)}`)
      }
    }
  }

  private async outcomeOf(conversation: Conversation, record: SettledSubmissionRecord): Promise<TurnOutcome> {
    switch (record.status) {
      case "done": {
        if (record.type !== "input") return { kind: "answered", text: "" }
        const answer = record.answer
        const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, answer), context)
        return { kind: "answered", text: answerText(entry?.model) }
      }
      case "unanswered":
        return { kind: "unanswered", reason: reasonOf(record), aborted: record.reason === "aborted" }
      default: {
        const never: never = record
        throw new Error(`Unknown submission ${JSON.stringify(never)}`)
      }
    }
  }

  async recover(): Promise<number> {
    const threads = (await this.harness.snapshot(ThreadsDoc, context))?.byThread ?? {}
    const work: Promise<TurnOutcome>[] = []
    for (const [thread, id] of Object.entries(threads)) {
      const conversation = await this.harness.conversation(id, context)
      const state = await this.harness.snapshot(ThreadDoc, id, context)
      if (!conversation || !state) continue
      for (const turn of state.pending) work.push(this.settle({ thread, conversation, turn, announce: true }))
    }
    await Promise.all(work)
    return work.length
  }

  async abort(thread: string): Promise<void> {
    await (await this.conversationFor(thread)).abort(context)
  }

  async close(): Promise<void> {
    await this.harness.close(context)
  }
}
