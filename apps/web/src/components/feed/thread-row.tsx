import type { MyThread } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type ThreadStatus = MyThread["status"]

type ChipVariant = "default" | "secondary" | "destructive"

const statusChips = {
  needs_you: { label: "Needs you", variant: "default" },
  running: { label: "Running", variant: "secondary" },
  blocked: { label: "Blocked", variant: "destructive" },
  unread: { label: "Unread", variant: "secondary" },
  done: null,
  quiet: null,
} as const satisfies Record<ThreadStatus, { label: string; variant: ChipVariant } | null>

export const statusRank = { needs_you: 0, running: 1, blocked: 2, unread: 3, quiet: 4, done: 5 } as const satisfies Record<ThreadStatus, number>

export const isDoneThread = (thread: MyThread) => thread.status === "done"

interface ThreadRowProps {
  thread: MyThread
  place: string
  when: string
  showChip: boolean
  onOpen: () => void
}

export function ThreadRow({ thread, place, when, showChip, onOpen }: ThreadRowProps) {
  const chip = statusChips[thread.status]
  const unread = thread.unread > 0
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid min-h-11 w-full items-start gap-3  px-1 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50",
          showChip ? "grid-cols-[76px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        {showChip && <span className="pt-px">{chip && <Badge variant={chip.variant}>{chip.label}</Badge>}</span>}
        <span className="min-w-0">
          <span className="flex items-baseline gap-[7px]">
            <span className={cn("truncate text-[13.5px]", unread ? "font-semibold" : "font-medium", thread.status === "done" && "text-muted-foreground")}>
              {thread.taskId !== null && <span className="mr-1.5">#{thread.taskId}</span>}
              {thread.title}
            </span>
            <span className="ml-auto flex-none text-xs text-faint tabular-nums">
              {place} · {when}
            </span>
          </span>
          <span className={cn("mt-0.5 line-clamp-2 block text-[13px] whitespace-pre-wrap", unread ? "text-foreground" : "text-muted-foreground")}>
            <span className="font-medium">{thread.lastWho}: </span>
            {thread.lastText}
          </span>
        </span>
      </button>
    </li>
  )
}
