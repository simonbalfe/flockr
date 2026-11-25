import { ChevronRight } from "lucide-react"
import { useState } from "react"
import type { FocusRun } from "@/api/focus"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { useNow } from "@/lib/now"
import { usePanel } from "@/lib/panel"
import { cn } from "@/lib/utils"

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
}

export function RunRow({ run }: { run: FocusRun }) {
  const [open, setOpen] = useState(false)
  const { openById } = usePanel()
  const now = useNow()
  const last = run.recent.length - 1
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-3 px-2 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        <MemberAvatar name={run.agent} size="xs" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{run.agent}</span>
          <span className="text-muted-foreground">
            {" · "}
            {run.taskId !== null && `#${run.taskId} `}
            {run.title}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {run.steps} {run.steps === 1 ? "step" : "steps"} · {minutesSince(run.startedAt, now)} min
        </span>
      </button>
      {open && (
        <div className="grid gap-1 pt-1 pb-2 pr-2 pl-16">
          {run.recent.length === 0 && <div className="text-sm text-faint">No steps yet.</div>}
          {run.recent.map((step, i) => (
            <div key={`${step.at}-${i}`} className={cn("flex min-w-0 gap-3 text-sm", i === last ? "text-foreground" : "text-muted-foreground")}>
              <span className="w-12 shrink-0 font-mono text-xs leading-5 text-faint">{step.kind}</span>
              <span className="min-w-0 truncate font-mono text-xs leading-5">{step.text}</span>
            </div>
          ))}
          <div>
            <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => openById(run.threadId)}>
              Open thread
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
