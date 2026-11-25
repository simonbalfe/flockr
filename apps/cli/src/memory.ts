import * as sdk from "@flockr/client"
import { memoryKinds, memoryKindLabels, type AddMemoryBody, type MemoryItem, type MemoryKind, type UpdateMemoryBody } from "@flockr/client"
import { run } from "./api"
import { int, need, optionalInt, UsageError, type Values } from "./args"
import type { CommandContext } from "./activity"
import { envMember } from "./config"

export function memoryLine(item: MemoryItem): string {
  const tags = item.tags.length ? `  [${item.tags.join(", ")}]` : ""
  const from = item.sourceThread ? `  from ${item.sourceThread}` : ""
  const state = item.archivedAt ? "  (archived)" : ""
  return `${String(item.id).padStart(4)} ${memoryKindLabels[item.kind].toLowerCase().padEnd(10)} ${item.text}${tags}${from}  by ${item.createdBy}${item.updatedBy === item.createdBy ? "" : `, edited by ${item.updatedBy}`}${state}`
}

// One mapping from a scope to its generated calls, so `flockr notes` and `flockr memory` share every line below.
interface Space {
  label: string
  list: (query: { state: "active" | "archived"; limit?: number; before?: number }) => Promise<MemoryItem[]>
  add: (body: AddMemoryBody) => Promise<MemoryItem>
  edit: (id: number, body: UpdateMemoryBody) => Promise<MemoryItem>
  archive: (id: number) => Promise<MemoryItem>
  restore: (id: number) => Promise<MemoryItem>
  empty: string
}

function agentSpace(values: Values): Space {
  const name = values.agent ?? values.as ?? envMember
  const path = { name }
  return {
    label: `${name}'s notes`,
    list: (query) => run(sdk.listAgentNotes({ path, query })),
    add: (body) => run(sdk.addAgentNote({ path, body })),
    edit: (id, body) => run(sdk.updateAgentNote({ path: { name, id }, body })),
    archive: (id) => run(sdk.archiveAgentNote({ path: { name, id } })),
    restore: (id) => run(sdk.restoreAgentNote({ path: { name, id } })),
    empty: `No notes yet. flockr notes add "<short note>" --kind decision saves one.`,
  }
}

function channelSpace(values: Values): Space {
  const channel = need(values.channel, "--channel").replace(/^#/, "")
  const path = { channel }
  return {
    label: `#${channel} memory`,
    list: (query) => run(sdk.listChannelMemory({ path, query })),
    add: (body) => run(sdk.addChannelMemory({ path, body })),
    edit: (id, body) => run(sdk.updateChannelMemory({ path: { channel, id }, body })),
    archive: (id) => run(sdk.archiveChannelMemory({ path: { channel, id } })),
    restore: (id) => run(sdk.restoreChannelMemory({ path: { channel, id } })),
    empty: `Nothing remembered yet. flockr memory add --channel ${channel} "<decision or fact>" --kind decision saves one.`,
  }
}

function kindOf(value: string | undefined): MemoryKind | undefined {
  if (value === undefined) return undefined
  const found = memoryKinds.find((k) => k === value)
  if (!found) throw new UsageError(`--kind must be one of ${memoryKinds.join(", ")}`)
  return found
}

const tagsOf = (values: Values) => (values.tag?.length ? values.tag : undefined)
const threadOf = (values: Values) => values.thread?.replace(/^#/, "")

async function memoryCommand(space: Space, command: "notes" | "memory", context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  const text = () => need(positionals.slice(2).join(" ").trim() || undefined, "text")
  const id = () => int(positionals[2], "item id")
  const show = (item: MemoryItem) => print(item, () => memoryLine(item))
  switch (sub) {
    case "list": {
      const items = await space.list({ state: values.archived ? "archived" : "active", limit: optionalInt(values.limit, "--limit"), before: optionalInt(values.before, "--before") })
      print(items, () => (items.length ? items.map(memoryLine).join("\n") : space.empty))
      return 0
    }
    case "add":
      show(await space.add({ text: text(), kind: kindOf(values.kind) ?? "fact", tags: tagsOf(values) ?? [], sourceThread: threadOf(values) ?? null, key: values.key }))
      return 0
    case "edit": {
      const newText = positionals.slice(3).join(" ").trim()
      const body = { text: newText || undefined, kind: kindOf(values.kind), tags: tagsOf(values), sourceThread: threadOf(values) }
      if (Object.values(body).every((v) => v === undefined)) throw new UsageError(`Give the new text, or --kind, --tag or --thread: flockr ${command} edit <id> "<new text>"`)
      show(await space.edit(id(), body))
      return 0
    }
    case "archive":
      show(await space.archive(id()))
      return 0
    case "restore":
      show(await space.restore(id()))
      return 0
    default:
      throw new UsageError(`Unknown command flockr ${command} ${sub}`)
  }
}

export const notesCommand = (context: CommandContext) => memoryCommand(agentSpace(context.values), "notes", context)
export const channelMemoryCommand = (context: CommandContext) => memoryCommand(channelSpace(context.values), "memory", context)
