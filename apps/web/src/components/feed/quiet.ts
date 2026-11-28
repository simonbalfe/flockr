import type { FeedItem, MemberKind, Task, TaskState, TextMessage } from "@/api/types"

export interface NeedsYou {
  tasks: ReadonlySet<number>
  threads: ReadonlySet<string>
}

export interface QuietContext {
  kindOf: (name: string) => MemberKind | undefined
  tasks: ReadonlyMap<number, Task>
  needsYou: NeedsYou
}

export type QuietPiece = { kind: "shown"; entries: FeedItem[] } | { kind: "hidden"; entries: FeedItem[] }

const stateNeedsPerson = {
  waiting: false,
  ready: false,
  claimed: false,
  blocked: true,
  review: true,
  done: false,
  failed: true,
  canceled: false,
} as const satisfies Record<TaskState, boolean>

export const threadKeyOf = (message: TextMessage): string | null => message.threadId ?? (message.taskId === null ? null : String(message.taskId))

export function messageNeedsYou(message: TextMessage, needsYou: NeedsYou): boolean {
  if (message.taskId !== null && needsYou.tasks.has(message.taskId)) return true
  const key = threadKeyOf(message)
  return key !== null && needsYou.threads.has(key)
}

function taskNeedsPerson(task: Task | undefined, needsYou: NeedsYou): boolean {
  return task !== undefined && (stateNeedsPerson[task.state] || task.question !== null || needsYou.tasks.has(task.id))
}

export function quietFeed(entries: FeedItem[], context: QuietContext): QuietPiece[] {
  const isAgent = (name: string) => context.kindOf(name) === "agent"
  const isPerson = (name: string) => context.kindOf(name) === "person"
  const taskOf = (id: number | null) => (id === null ? undefined : context.tasks.get(id))
  let awaited = new Set<string>()

  const shows = (item: FeedItem): boolean => {
    if (!isAgent(item.who)) {
      if (item.kind === "text" && isPerson(item.who)) awaited = new Set(item.mentions.filter(isAgent))
      return true
    }
    switch (item.kind) {
      case "ask":
        return true
      case "event":
        return false
      case "task":
        return taskNeedsPerson(taskOf(item.taskId), context.needsYou)
      case "text": {
        const answersPerson = awaited.delete(item.who)
        return answersPerson || item.mentions.some(isPerson) || messageNeedsYou(item, context.needsYou) || taskNeedsPerson(taskOf(item.taskId), context.needsYou)
      }
      default: {
        const unhandled: never = item
        return unhandled
      }
    }
  }

  const pieces: QuietPiece[] = []
  for (const item of entries) {
    const kind = shows(item) ? "shown" : "hidden"
    const last = pieces[pieces.length - 1]
    if (last?.kind === kind) last.entries.push(item)
    else pieces.push({ kind, entries: [item] })
  }
  return pieces
}

export function hiddenRunLabel(entries: FeedItem[]): string {
  return `${entries.length} agent ${entries.length === 1 ? "message" : "messages"}`
}
