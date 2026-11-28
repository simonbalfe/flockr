import type { Context } from "@earendil-works/chord/context"
import {
  defineDoc,
  defineExtension,
  defineTool,
  hook,
  ToolTask,
  type ConversationId,
  type DocumentReader,
  type SubmissionId,
  type ToolExecutionResult,
  type ToolHookCall,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools"
import type { RunStatus, TaskState, Thread, ThreadEntry } from "@flockr/client"
import { z } from "zod"
import type { ToolKind, Verdict } from "../../permissions"
import { threadLines } from "../../prompt"
import type { FencedBoard, PiBoard } from "./board"
import { insideFolder } from "./folder"

export type TurnRecord = {
  requestId: string
  messageId: string | null
  submissionId: SubmissionId
}

export type ThreadState = {
  thread: string
  folder: string | null
  channel?: string | null
  pending: TurnRecord[]
  posted: string[]
}

export const ThreadDoc = defineDoc<ThreadState>({
  kind: "flockr.thread",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ thread: "", folder: null, channel: null, pending: [], posted: [] }),
  checkpointWhen: () => true,
})

export const keptPosted = 200

export const toolNames = {
  readThread: "read_thread",
  reply: "reply_in_thread",
  ask: "ask_person",
  createTask: "create_task",
} as const

export const runIdFor = (thread: string) => `pi-${thread}`

const offered = { allow: true, ask: false, deny: false } as const satisfies Record<Verdict, boolean>
const openTask = { waiting: true, ready: true, claimed: true, blocked: true, review: true, done: false, failed: true, canceled: false } as const satisfies Record<TaskState, boolean>
const runningStatus = { running: true, ok: false, error: false, stopped: false } as const satisfies Record<RunStatus, boolean>

function parameters(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _dropped, ...json } = z.toJSONSchema(schema, { io: "input" })
  return json
}

const text = (body: string, isError = false): ToolExecutionResult => ({ output: [{ type: "text", text: body }], isError })

const entryText = (entry: ThreadEntry): string | null => (entry.kind === "reply" && !entry.deleted ? entry.text : null)

export function alreadyPosted(options: { thread: Thread; member: string; after: string | null; text: string }): boolean {
  const { thread, member, after } = options
  const wanted = options.text.trim()
  const start = after === null ? 0 : thread.entries.findIndex((e) => e.id === after) + 1
  return thread.entries.slice(Math.max(start, 0)).some((e) => e.kind === "reply" && e.who === member && entryText(e)?.trim() === wanted)
}

export function triggerOf(options: { thread: Thread; member: string; text: string }): string | null {
  const { thread, member } = options
  const others = thread.entries.filter((e) => e.kind === "reply" && e.who !== member && !e.deleted)
  const inText = others.filter((e) => {
    const body = entryText(e)?.trim() ?? ""
    return body.length > 0 && options.text.includes(body.slice(0, 200))
  })
  const latest = inText.at(-1) ?? null
  if (latest) return latest.id
  if (thread.root && thread.root.who !== member) return thread.root.id
  return others.at(-1)?.id ?? null
}

export interface ToolDeps {
  member: string
  board: FencedBoard
  log: (line: string) => void
}

const ReadThreadArgs = z.object({})
const ReplyArgs = z.object({ text: z.string().trim().min(1).max(4000).describe("A short progress note for the thread") })
const AskArgs = z.object({
  question: z.string().trim().min(1).max(300).describe("The question, one sentence"),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(4).describe("Two to four short answers a person can pick"),
  detail: z.string().max(1500).default("").describe("Optional context shown under the question"),
})
const CreateTaskArgs = z.object({
  title: z.string().trim().min(1).max(200),
  spec: z.string().max(4000).default("").describe("What done means, in a few lines"),
  quote: z.string().trim().min(3).max(500).describe("The exact words in which a person in this thread asked for a task"),
  assignee: z.string().trim().min(1).optional().describe("A member to bind the task to, only if the person named one"),
})

export async function threadState(reader: DocumentReader, conversationId: ConversationId, context: Context): Promise<Readonly<ThreadState> | null> {
  return (await reader.snapshot(ThreadDoc, conversationId, context)) ?? null
}

export const boardOf = (deps: Pick<ToolDeps, "board">, state: Readonly<ThreadState>): PiBoard => deps.board(state.channel ?? null)

export function boardTools(deps: ToolDeps): ToolRegistration[] {
  const { member } = deps

  const readThread = defineTool({
    name: toolNames.readThread,
    description: "Read the whole board thread you are answering, newest last.",
    parameters: parameters(ReadThreadArgs),
    replay: "safe",
    execute: async (_args, api, context) => {
      const state = await threadState(api, api.conversationId, context)
      if (!state?.thread) return text("No thread is linked to this conversation.", true)
      const board = boardOf(deps, state)
      return text(threadLines(await board.thread(state.thread)) || "(the thread is empty)")
    },
  })

  const reply = defineTool({
    name: toolNames.reply,
    description: "Post a short progress note in the thread during long work. Never use it for your final answer: that is posted for you.",
    parameters: parameters(ReplyArgs),
    replay: "unsafe",
    execute: async (args, api, context) => {
      const parsed = ReplyArgs.safeParse(args)
      if (!parsed.success) return text(`Invalid arguments: ${parsed.error.message}`, true)
      const state = await threadState(api, api.conversationId, context)
      if (!state?.thread) return text("No thread is linked to this conversation.", true)
      const board = boardOf(deps, state)
      const after = state.pending[0]?.messageId ?? null
      if (alreadyPosted({ thread: await board.thread(state.thread), member, after, text: parsed.data.text })) return text("Already posted.")
      await board.reply(state.thread, parsed.data.text)
      return text("Posted.")
    },
  })

  const ask = defineTool({
    name: toolNames.ask,
    description:
      "Ask a person in the thread a question with two to four answers to pick from, as a question card. Only a person can answer it, never you. Their answer arrives later as a new message, so end your turn after asking.",
    parameters: parameters(AskArgs),
    replay: "unsafe",
    execute: async (args, api, context) => {
      const parsed = AskArgs.safeParse(args)
      if (!parsed.success) return text(`Invalid arguments: ${parsed.error.message}`, true)
      const state = await threadState(api, api.conversationId, context)
      if (!state?.thread) return text("No thread is linked to this conversation.", true)
      const board = boardOf(deps, state)
      const current = await board.thread(state.thread)
      const open = current.entries.find((e) => e.kind === "question" && e.answer === null)
      if (open?.kind === "question" && open.who === member && open.question.text === parsed.data.question) return text("You already asked this; wait for a person to answer.")
      const asked = await board.ask(state.thread, { text: parsed.data.question, detail: parsed.data.detail, options: parsed.data.options })
      switch (asked.kind) {
        case "asked":
          return text("Asked. Only a person can answer. End your turn now; the answer will come as a new message in this thread.", false)
        case "refused":
          return text(`${asked.reason}. Say in your answer what you need instead.`, true)
        default: {
          const never: never = asked
          throw new Error(`Unknown ask result ${JSON.stringify(never)}`)
        }
      }
    },
  })

  const createTask = defineTool({
    name: toolNames.createTask,
    description:
      "Create a tracked task on the board. Only when a person in this thread asked for a task; quote their exact words. Never create one on your own initiative.",
    parameters: parameters(CreateTaskArgs),
    replay: "unsafe",
    execute: async (args, api, context) => {
      const parsed = CreateTaskArgs.safeParse(args)
      if (!parsed.success) return text(`Invalid arguments: ${parsed.error.message}`, true)
      const state = await threadState(api, api.conversationId, context)
      if (!state?.thread) return text("No thread is linked to this conversation.", true)
      const board = boardOf(deps, state)
      const current = await board.thread(state.thread)
      const messages = [...(current.root ? [current.root] : []), ...current.entries.flatMap((e) => (e.kind === "reply" ? [e] : []))]
      const said = messages.flatMap((m) => (!m.deleted && m.who !== member && m.text.includes(parsed.data.quote) ? [m.who] : []))
      const kinds = await Promise.all([...new Set(said)].map((who) => board.memberKind(who)))
      if (!kinds.includes("person")) return text("No person in this thread asked for a task in those words, so no task was made. Answer in the thread instead.", true)
      const existing = (await board.tasks(current.channel)).find((t) => t.title === parsed.data.title && openTask[t.state])
      if (existing) return text(`Task #${existing.id} "${existing.title}" already exists.`)
      const task = await board.createTask({
        channel: current.channel,
        title: parsed.data.title,
        spec: parsed.data.spec || null,
        assignee: parsed.data.assignee ?? null,
        text: `Made from thread ${state.thread} because ${member} was asked: "${parsed.data.quote}"`,
      })
      return text(`Created task #${task.id}.`)
    },
  })

  return [readThread, reply, ask, createTask]
}

export function boardExtension(deps: ToolDeps) {
  const { member, log } = deps
  const partOf = new Map<string, { entryId: string; board: PiBoard }>()

  const entryFor = async (board: PiBoard, thread: string): Promise<string | null> => {
    const current = await board.thread(thread)
    const running = current.entries.flatMap((e) => (e.kind === "activity" && e.who === member && e.runId === runIdFor(thread) && runningStatus[e.status] ? [e.id] : []))
    return running.at(-1) ?? null
  }

  const quietly = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (error) {
      log(`activity: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const started = async (call: ToolHookCall, state: Readonly<ThreadState>) =>
    quietly(async () => {
      const board = boardOf(deps, state)
      const entryId = await entryFor(board, state.thread)
      if (!entryId) return
      partOf.set(call.id, { entryId, board })
      await board.updateEntry(entryId, [{ type: "part.set", part: { id: call.id.slice(0, 80), type: "tool", name: call.name, input: call.arguments, status: "running" } }])
    })

  const finished = async (call: ToolHookCall, result: ToolExecutionResult) =>
    quietly(async () => {
      const part = partOf.get(call.id)
      if (!part) return
      partOf.delete(call.id)
      const { entryId, board } = part
      const output = (result.output ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n").slice(0, 4000)
      await board.updateEntry(entryId, [{ type: "part.finished", partId: call.id.slice(0, 80), status: result.isError ? "error" : "ok", output }])
    })

  return defineExtension({
    name: "flockr-board",
    tools: boardTools(deps),
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          const state = await threadState(api, api.conversationId, context)
          if (state?.thread) await started(call, state)
          return undefined
        },
        afterTool: async (call, result) => {
          await finished(call, result)
          return undefined
        },
      }),
    ],
  })
}

export const fileTools = {
  read: { tool: createReadTool(), kind: "read" },
  write: { tool: createWriteTool(), kind: "edit" },
  edit: { tool: createEditTool(), kind: "edit" },
} as const satisfies Record<string, { tool: ToolRegistration; kind: ToolKind }>

const PathArgs = z.object({ path: z.string() }).loose()

export const filesExtension = defineExtension({
  name: "flockr-files",
  tools: Object.values(fileTools).map((f) => f.tool),
  hooks: [
    hook(ToolTask, {
      beforeTool: async (call, api, context) => {
        if (!Object.values(fileTools).some((f) => f.tool.name === call.name)) return undefined
        const state = await threadState(api, api.conversationId, context)
        if (!state?.folder) return { block: "This agent has no folder, so it has no file access." }
        const args = PathArgs.safeParse(call.arguments)
        if (!args.success) return { block: "A file tool needs a path." }
        const checked = insideFolder(state.folder, args.data.path)
        switch (checked.kind) {
          case "inside":
            return { arguments: { ...call.arguments, path: checked.path } }
          case "refused":
            return { block: checked.reason }
          default: {
            const never: never = checked
            throw new Error(`Unknown folder check ${JSON.stringify(never)}`)
          }
        }
      },
    }),
  ],
})

export function offeredFileTools(rule: Readonly<Record<ToolKind, Verdict>>): ToolRegistration[] {
  return Object.values(fileTools).flatMap((f) => (offered[rule[f.kind]] ? [f.tool] : []))
}

