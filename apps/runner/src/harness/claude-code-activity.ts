import { activityLimits, type ActivityPartInput, type ActivityUpdate, type PlanStep } from "@flockr/client"
import { z } from "zod"
import type { ToolKind } from "../permissions"

const TextBlock = z.object({ type: z.literal("text"), text: z.string() })
const ThinkingBlock = z.object({ type: z.literal("thinking"), thinking: z.string() })
const ToolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string().min(1), name: z.string().min(1), input: z.record(z.string(), z.unknown()).catch({}) })
const AssistantBlock = z.discriminatedUnion("type", [TextBlock, ThinkingBlock, ToolUseBlock])

const ResultText = z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))])
const ToolResultBlock = z.object({ type: z.literal("tool_result"), tool_use_id: z.string().min(1), content: ResultText.optional(), is_error: z.boolean().optional() })

const fromMainAgent = { parent_tool_use_id: z.string().nullable().optional() }

const StreamLine = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assistant"), ...fromMainAgent, message: z.object({ content: z.array(z.unknown()) }) }),
  z.object({ type: z.literal("user"), ...fromMainAgent, message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }) }),
  z.object({ type: z.literal("result"), subtype: z.string().optional(), is_error: z.boolean().optional(), result: z.string().optional() }),
])

const TodoInput = z.object({ todos: z.array(z.object({ content: z.string().trim().min(1), status: z.enum(["pending", "in_progress", "completed"]) })).max(activityLimits.items) })
const SubagentInput = z.object({ description: z.string().optional(), prompt: z.string().optional(), subagent_type: z.string().optional() }).catch({})
const EditInput = z.object({
  file_path: z.string().min(1).optional(),
  notebook_path: z.string().min(1).optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional(),
  content: z.string().optional(),
  new_source: z.string().optional(),
  edits: z.array(z.object({ old_string: z.string(), new_string: z.string() })).optional(),
})
const CommandInput = z.object({ command: z.string().trim().min(1) })

const todoStatus = { pending: "pending", in_progress: "doing", completed: "done" } as const satisfies Record<z.infer<typeof TodoInput>["todos"][number]["status"], PlanStep["status"]>

const planTools = ["TodoWrite"]
const subagentTools = ["Task", "Agent"]

const limits = { input: 2000, output: 4000, diff: 8000, task: 200, list: 50 } as const
const planId = "plan"
const filesId = "files"

type Tracked = "tool" | "terminal" | "subagent" | "plan" | "edit"

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)
const clipTail = (text: string, max: number) => (text.length > max ? `...${text.slice(text.length - max + 3)}` : text)

function clipValue(value: unknown): unknown {
  if (typeof value === "string") return clip(value, limits.input)
  if (Array.isArray(value)) return value.slice(0, limits.list).map(clipValue)
  if (typeof value === "object" && value !== null) return clipInput(Object.fromEntries(Object.entries(value)))
  return value
}

const clipInput = (input: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, clipValue(value)]))

function resultText(content: z.infer<typeof ResultText> | undefined): string {
  if (content === undefined) return ""
  if (typeof content === "string") return content
  return content.flatMap((block) => (block.text ? [block.text] : [])).join("\n")
}

const lineCount = (text: string) => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length)

function hunk(before: string, after: string): string {
  const removed = before === "" ? [] : before.replace(/\n$/, "").split("\n").map((line) => `-${line}`)
  const added = after === "" ? [] : after.replace(/\n$/, "").split("\n").map((line) => `+${line}`)
  return ["@@", ...removed, ...added].join("\n")
}

interface FileEdit {
  path: string
  added: number
  removed: number
  diff: string
}

function editOf(input: Record<string, unknown>): FileEdit | null {
  const parsed = EditInput.safeParse(input)
  if (!parsed.success) return null
  const edit = parsed.data
  const path = edit.file_path ?? edit.notebook_path
  if (!path) return null
  const pairs = edit.edits ?? (edit.old_string !== undefined || edit.new_string !== undefined ? [{ old_string: edit.old_string ?? "", new_string: edit.new_string ?? "" }] : [])
  const written = edit.content ?? edit.new_source
  const changes = pairs.length ? pairs : written === undefined ? [] : [{ old_string: "", new_string: written }]
  return {
    path,
    added: changes.reduce((sum, c) => sum + lineCount(c.new_string), 0),
    removed: changes.reduce((sum, c) => sum + lineCount(c.old_string), 0),
    diff: changes.map((c) => hunk(c.old_string, c.new_string)).join("\n"),
  }
}

export interface ClaudeActivityOptions {
  cwd: string
  kindOf: (tool: string) => ToolKind
}

export function claudeActivity(options: ClaudeActivityOptions) {
  const parts = new Set<string>()
  const tracked = new Map<string, { kind: Tracked; input: Record<string, unknown> }>()
  const files = new Map<string, FileEdit>()
  let pendingText: string | null = null
  let counter = 0

  const nextId = (prefix: string) => {
    counter += 1
    return `${prefix}${counter}`
  }

  const room = (id: string) => parts.has(id) || parts.size < activityLimits.parts

  const set = (part: ActivityPartInput & { id: string }): ActivityUpdate[] => {
    if (!room(part.id)) return []
    parts.add(part.id)
    return [{ type: "part.set", part }]
  }

  const thought = (text: string): ActivityUpdate[] => {
    const trimmed = text.trim()
    return trimmed ? set({ type: "reasoning", id: nextId("r"), text: clipTail(trimmed, activityLimits.text), status: "ok" }) : []
  }

  const flushText = (): ActivityUpdate[] => {
    const text = pendingText
    pendingText = null
    return text === null ? [] : thought(text)
  }

  function partFor(block: z.infer<typeof ToolUseBlock>): { kind: Tracked; part: ActivityPartInput & { id: string } } {
    const id = block.id.slice(0, 80)
    const input = clipInput(block.input)
    if (planTools.includes(block.name)) {
      const todos = TodoInput.safeParse(block.input)
      if (todos.success) return { kind: "plan", part: { type: "plan", id: planId, title: null, steps: todos.data.todos.map((t) => ({ text: clip(t.content, limits.task), status: todoStatus[t.status] })) } }
    }
    if (subagentTools.includes(block.name)) {
      const task = SubagentInput.parse(block.input)
      const text = task.description?.trim() || task.prompt?.trim() || "A delegated task"
      return { kind: "subagent", part: { type: "subagent", id, name: task.subagent_type?.trim() || "subagent", task: clip(text, limits.task), status: "running" } }
    }
    const kind = options.kindOf(block.name)
    const command = CommandInput.safeParse(block.input)
    if (kind === "command" && command.success) return { kind: "terminal", part: { type: "terminal", id, command: clip(command.data.command, limits.input), cwd: options.cwd, status: "running" } }
    return { kind: kind === "edit" ? "edit" : "tool", part: { type: "tool", id, name: block.name, input, status: "running" } }
  }

  function toolUse(block: z.infer<typeof ToolUseBlock>): ActivityUpdate[] {
    const { kind, part } = partFor(block)
    const updates = set(part)
    if (updates.length) tracked.set(block.id, { kind, input: block.input })
    return updates
  }

  function changedFiles(input: Record<string, unknown>): ActivityUpdate[] {
    const edit = editOf(input)
    if (!edit) return []
    const known = files.get(edit.path)
    files.set(edit.path, known ? { path: edit.path, added: known.added + edit.added, removed: known.removed + edit.removed, diff: `${known.diff}\n${edit.diff}` } : edit)
    const list = [...files.values()].slice(-activityLimits.items).map((f) => ({ path: f.path, added: f.added, removed: f.removed, diff: clip(f.diff, limits.diff) }))
    return set({ type: "files", id: filesId, files: list })
  }

  function toolResult(block: z.infer<typeof ToolResultBlock>): ActivityUpdate[] {
    const call = tracked.get(block.tool_use_id)
    if (!call) return []
    tracked.delete(block.tool_use_id)
    const partId = block.tool_use_id.slice(0, 80)
    const status = block.is_error ? "error" : "ok"
    const text = resultText(block.content)
    switch (call.kind) {
      case "plan":
        return []
      case "terminal": {
        const code = /exit code (\d+)/i.exec(text.split("\n")[0] ?? "")?.[1]
        const exitCode = block.is_error ? (code === undefined ? undefined : Number(code)) : 0
        return [{ type: "part.finished", partId, status, output: clipTail(text, limits.output), ...(exitCode === undefined ? {} : { exitCode }) }]
      }
      case "subagent": {
        const summary = clip(text.trim(), limits.output)
        return [...(summary ? [{ type: "part.append" as const, partId, text: summary }] : []), { type: "part.finished", partId, status }]
      }
      case "edit":
        return [{ type: "part.finished", partId, status, output: clip(text, limits.output) }, ...(block.is_error ? [] : changedFiles(call.input))]
      case "tool":
        return [{ type: "part.finished", partId, status, output: clip(text, limits.output) }]
      default: {
        const never: never = call.kind
        throw new Error(`Unknown tool kind ${String(never)}`)
      }
    }
  }

  function assistant(content: unknown[]): ActivityUpdate[] {
    const updates: ActivityUpdate[] = []
    for (const raw of content) {
      const block = AssistantBlock.safeParse(raw)
      if (!block.success) continue
      updates.push(...flushText())
      switch (block.data.type) {
        case "text":
          if (block.data.text.trim()) pendingText = block.data.text
          break
        case "thinking":
          updates.push(...thought(block.data.thinking))
          break
        case "tool_use":
          updates.push(...toolUse(block.data))
          break
        default: {
          const never: never = block.data
          throw new Error(`Unknown block ${JSON.stringify(never)}`)
        }
      }
    }
    return updates
  }

  function user(content: string | unknown[]): ActivityUpdate[] {
    if (typeof content === "string") return []
    return content.flatMap((raw) => {
      const block = ToolResultBlock.safeParse(raw)
      return block.success ? toolResult(block.data) : []
    })
  }

  function result(line: { subtype?: string; is_error?: boolean; result?: string }): ActivityUpdate[] {
    pendingText = null
    if (!line.is_error) return []
    const message = clip(line.result?.trim() || line.subtype || "The run reported an error", limits.output)
    return set({ type: "error", id: nextId("error"), name: line.subtype ?? null, message })
  }

  return {
    read(value: unknown): ActivityUpdate[] {
      const line = StreamLine.safeParse(value)
      if (!line.success) return []
      switch (line.data.type) {
        case "assistant":
          return line.data.parent_tool_use_id ? [] : assistant(line.data.message.content)
        case "user":
          return line.data.parent_tool_use_id ? [] : user(line.data.message.content)
        case "result":
          return result(line.data)
        default: {
          const never: never = line.data
          throw new Error(`Unknown line ${JSON.stringify(never)}`)
        }
      }
    },
  }
}
