import type { TaskState } from "@/api/types"
import { cn } from "@/lib/utils"

export function StateDot({ state, className }: { state: TaskState; className?: string }) {
  const tone = state === "blocked" ? "text-destructive" : state === "waiting" ? "text-faint" : "text-foreground"
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn("size-3 shrink-0", tone, className)}>
      {state === "waiting" && <rect x="1.25" y="1.25" width="9.5" height="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2.1" />}
      {state === "ready" && <rect x="1.25" y="1.25" width="9.5" height="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {state === "claimed" && (
        <>
          <rect x="1.25" y="1.25" width="9.5" height="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="6" y="1.25" width="4.75" height="9.5" fill="currentColor" />
        </>
      )}
      {state === "review" && (
        <>
          <rect x="1.25" y="1.25" width="9.5" height="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="4" y="4" width="4" height="4" fill="currentColor" />
        </>
      )}
      {(state === "done" || state === "blocked") && <rect x="0.6" y="0.6" width="10.8" height="10.8" fill="currentColor" />}
    </svg>
  )
}
