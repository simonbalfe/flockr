import type { ReactNode } from "react"
import { useMembers, useTasks } from "@/api/hooks"
import { usePanel } from "@/lib/panel"

const token = /`([^`]+)`|@([a-z][a-z-]*)|#(\d{3})\b/g

export function RichText({ text }: { text: string }) {
  const members = useMembers()
  const tasks = useTasks()
  const { openTask } = usePanel()
  const memberNames = new Set(members.data?.map((m) => m.name))
  const taskIds = new Set(tasks.data?.map((t) => t.id))
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(token)) {
    const start = match.index
    if (start > last) parts.push(text.slice(last, start))
    const [whole, code, mention, taskId] = match
    if (code) {
      parts.push(
        <code key={start} className="rounded bg-muted px-1 py-px font-mono text-[12.5px]">
          {code}
        </code>,
      )
    } else if (mention && memberNames.has(mention)) {
      parts.push(
        <span key={start} className="rounded bg-muted px-[3px] font-medium text-foreground">
          @{mention}
        </span>,
      )
    } else if (taskId && taskIds.has(Number(taskId))) {
      parts.push(
        <button
          key={start}
          type="button"
          onClick={() => openTask(Number(taskId))}
          className="text-foreground underline decoration-accent underline-offset-[3px] tabular-nums hover:decoration-foreground"
        >
          #{taskId}
        </button>,
      )
    } else {
      parts.push(whole)
    }
    last = start + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
