import type { ChannelDocument, MemoryItem } from "@flockr/client"
import { documentLimits } from "@flockr/contracts/documents"
import { memoryKindLabels, memoryKindOrder, memoryLimits } from "@flockr/contracts/memory"

export interface MemoryContext {
  notes: MemoryItem[]
  channel: MemoryItem[]
  document?: ChannelDocument | null
}

export const noMemory: MemoryContext = { notes: [], channel: [] }

const rank = (item: MemoryItem) => memoryKindOrder.indexOf(item.kind)

const line = (item: MemoryItem) =>
  `- [${memoryKindLabels[item.kind].toLowerCase()}] ${item.text}${item.tags.length ? ` (${item.tags.join(", ")})` : ""}${item.sourceThread ? ` (from ${item.sourceThread})` : ""} #${item.id}`

// Whole items, dead ends and decisions first, then the most recently changed, until the characters are used up.
export function fit(items: readonly MemoryItem[], budget: number): { lines: string[]; left: number } {
  const ordered = [...items].sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
  const lines: string[] = []
  let used = 0
  for (const item of ordered) {
    const text = line(item)
    if (used + text.length + 1 > budget) break
    lines.push(text)
    used += text.length + 1
  }
  return { lines, left: ordered.length - lines.length }
}

export function documentLines(channel: string, document: ChannelDocument | null | undefined, cap: number = documentLimits.promptChars): string[] {
  if (!document || document.version === 0 || !document.text.trim()) return []
  const text = document.text.trim()
  const cut = text.length > cap
  return [
    `The #${channel} document, version ${document.version} by ${document.editedBy ?? "someone"} (read it first; to change it: flockr doc edit ${channel} --replaces ${document.version} --file <path>):`,
    cut ? text.slice(0, cap) : text,
    ...(cut ? [`(cut at ${cap} of ${text.length} characters; read it all with flockr doc show ${channel})`] : []),
    "",
  ]
}

export function memoryBlock(channel: string, context: MemoryContext, caps: { notes: number; channel: number } = { notes: memoryLimits.promptNotesChars, channel: memoryLimits.promptChannelChars }): string {
  const shared = fit(context.channel, caps.channel)
  const own = fit(context.notes, caps.notes)
  const sections = [
    ...documentLines(channel, context.document),
    ...(context.channel.length
      ? [
          `What #${channel} remembers (decisions and facts every agent here reads first; #id is for flockr memory edit/archive --channel ${channel}):`,
          ...shared.lines,
          ...(shared.left ? [`(${shared.left} more; flockr memory list --channel ${channel})`] : []),
        ]
      : []),
    ...(context.notes.length ? ["Your notes (what you saved in earlier conversations; flockr notes edit/archive <id>):", ...own.lines, ...(own.left ? [`(${own.left} more; flockr notes list)`] : [])] : []),
  ]
  return sections.join("\n").trimEnd()
}
