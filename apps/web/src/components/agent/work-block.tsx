import { useState } from "react"
import type { ActivityEntry } from "@/api/types"
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought"
import { PartRow, PlanSteps } from "@/components/agent/parts"
import { RunningText } from "@/components/agent/running-text"
import { runIcon, StatusGlyph } from "@/components/agent/status-glyph"
import { useClock } from "@/components/agent/use-clock"
import { duration, summarizeWork } from "@/lib/work"

const verb = { running: "Working", ok: "Worked", error: "Worked", stopped: "Stopped after" } as const satisfies Record<ActivityEntry["status"], string>

const stepStatus = { running: "active", ok: "complete", error: "complete", stopped: "complete" } as const satisfies Record<ActivityEntry["status"], "active" | "complete">

function latestPlan(entries: ActivityEntry[]) {
  for (const entry of [...entries].reverse()) {
    const plan = [...entry.parts].reverse().find((p) => p.type === "plan")
    if (plan) return plan
  }
  return undefined
}

function EntryParts({ entry }: { entry: ActivityEntry }) {
  if (entry.parts.length === 0) return <span className="text-[13px] text-muted-foreground">No steps yet</span>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {entry.parts.map((part) => (
        <PartRow key={part.id} part={part} />
      ))}
    </div>
  )
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
    <ChainOfThought open={open} onOpenChange={setOpen} className="ai-elements-mono mt-1.5 max-w-[640px] space-y-0 bg-muted/60 px-3.5 py-2.5">
      <ChainOfThoughtHeader
        aria-label={open ? "Hide steps" : "Show steps"}
        className="items-start gap-2.5 text-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:mt-[3px] [&>svg]:size-3.5 [&>svg]:text-muted-foreground [&>span]:min-w-0 [&>svg:first-child]:hidden"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <StatusGlyph status={summary.status} className="mt-[3px]" />
          <span className="min-w-0 flex-1">
            <RunningText text={summary.headline} running={running} className="block truncate font-medium [--color-muted-foreground:var(--foreground)]" />
            <span className="block truncate text-[12.5px] text-muted-foreground tabular-nums">
              {verb[summary.status]} for {duration(summary.durationMs)}
              {facts && ` · ${facts}`}
              {summary.stopRequested && " · stop requested"}
            </span>
          </span>
        </span>
      </ChainOfThoughtHeader>
      {plan && running && !open && (
        <div className="mt-2 ml-6">
          <PlanSteps steps={plan.steps} />
        </div>
      )}
      <ChainOfThoughtContent className="mt-2.5 ml-6 min-w-0 space-y-3 text-foreground">
        {single ? (
          entries[0] && <EntryParts entry={entries[0]} />
        ) : (
          entries.map((entry) => (
            <ChainOfThoughtStep key={entry.id} icon={runIcon(entry.status)} status={stepStatus[entry.status]} label={<span className="text-xs font-medium">{entry.title}</span>}>
              <EntryParts entry={entry} />
            </ChainOfThoughtStep>
          ))
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}
