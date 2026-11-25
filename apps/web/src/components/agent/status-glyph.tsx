import { CircleCheck, CircleDashed, CircleDot, CircleStop, CircleX, LoaderCircle, type LucideIcon } from "lucide-react"
import type { PlanStep } from "@/api/types"
import type { WorkStatus } from "@/lib/work"
import { cn } from "@/lib/utils"

const runGlyph = {
  running: { icon: LoaderCircle, label: "Running" },
  ok: { icon: CircleCheck, label: "Done" },
  error: { icon: CircleX, label: "Failed" },
  stopped: { icon: CircleStop, label: "Stopped" },
} as const satisfies Record<WorkStatus, { icon: LucideIcon; label: string }>

const stepGlyph = {
  pending: { icon: CircleDashed, label: "To do" },
  doing: { icon: CircleDot, label: "Doing" },
  done: { icon: CircleCheck, label: "Done" },
} as const satisfies Record<PlanStep["status"], { icon: LucideIcon; label: string }>

export function StatusGlyph({ status, className }: { status: WorkStatus; className?: string }) {
  const { icon: Icon, label } = runGlyph[status]
  return <Icon aria-label={label} role="img" className={cn("size-3.5 shrink-0", status === "running" && "animate-spin motion-reduce:animate-none", className)} strokeWidth={2} />
}

export function StepGlyph({ status }: { status: PlanStep["status"] }) {
  const { icon: Icon, label } = stepGlyph[status]
  return <Icon aria-label={label} role="img" className={cn("size-3.5 shrink-0", status === "done" && "text-muted-foreground")} strokeWidth={2} />
}

export const statusLabel = (status: WorkStatus) => runGlyph[status].label
