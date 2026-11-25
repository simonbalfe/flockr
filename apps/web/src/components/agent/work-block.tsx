import { ChevronRight } from "lucide-react"
import { useState } from "react"
import type { ActivityEntry } from "@/api/types"
import { PartRow, PlanSteps } from "@/components/agent/parts"
import { StatusGlyph } from "@/components/agent/status-glyph"
import { useClock } from "@/components/agent/use-clock"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Trace } from "@/components/ui/trace"
import { duration, summarizeWork } from "@/lib/work"
import { cn } from "@/lib/utils"

const verb = { running: "Working", ok: "Worked", error: "Worked", stopped: "Stopped after" } as const satisfies Record<ActivityEntry["status"], string>

function latestPlan(entries: ActivityEntry[]) {
  for (const entry of [...entries].reverse()) {
    const plan = [...entry.parts].reverse().find((p) => p.type === "plan")
    if (plan) return plan
  }
  return undefined
}

export function WorkBlock({ entries }: { entries: ActivityEntry[] }) {
  const running = entries.some((e) => e.status === "running")
  const now = useClock(running)
  const [open, setOpen] = useState(false)
  const summary = summarizeWork(entries, now)
  const plan = latestPlan(entries)
  const single = entries.length === 1
  const facts = [summary.detail, summary.failed ? `${summary.failed} failed` : ""].filter(Boolean).join(" · ")

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1.5 max-w-[640px] rounded-xl bg-muted/60 px-3.5 py-2.5">
      <CollapsibleTrigger className="group/work flex w-full min-w-0 items-start gap-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <StatusGlyph status={summary.status} className="mt-[3px]" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", running && "shimmer motion-reduce:shimmer-none")}>{summary.headline}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground tabular-nums">
            {verb[summary.status]} for {duration(summary.durationMs)}
            {facts && ` · ${facts}`}
            {summary.stopRequested && " · stop requested"}
          </span>
        </span>
        <ChevronRight aria-hidden className="mt-[3px] size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/work:rotate-90" />
        <span className="sr-only">{open ? "Hide steps" : "Show steps"}</span>
      </CollapsibleTrigger>
      {plan && running && !open && (
        <div className="mt-2 ml-6">
          <PlanSteps steps={plan.steps} />
        </div>
      )}
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="mt-2.5 ml-6 flex min-w-0 flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="flex min-w-0 flex-col gap-2">
              {!single && (
                <Marker className="text-xs font-medium">
                  <MarkerContent>{entry.title}</MarkerContent>
                </Marker>
              )}
              <Trace>
                {entry.parts.map((part) => (
                  <PartRow key={part.id} part={part} />
                ))}
              </Trace>
              {entry.parts.length === 0 && <span className="text-[13px] text-muted-foreground">No steps yet</span>}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
