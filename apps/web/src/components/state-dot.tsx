import type { TaskState } from "@/api/types"
import { cn } from "@/lib/utils"

export function StateDot({ state, className }: { state: TaskState; className?: string }) {
  const tone = state === "blocked" ? "text-destructive" : state === "waiting" ? "text-faint" : "text-foreground"
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn("size-3 shrink-0", tone, className)}>
      {state === "waiting" && <circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2.1" />}
      {state === "ready" && <circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {state === "claimed" && (
        <>
          <circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.1a4.9 4.9 0 0 1 0 9.8z" fill="currentColor" />
        </>
      )}
      {state === "review" && (
        <>
          <circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="6" cy="6" r="2.2" fill="currentColor" />
        </>
      )}
      {(state === "done" || state === "blocked") && <circle cx="6" cy="6" r="5.4" fill="currentColor" />}
    </svg>
  )
}
