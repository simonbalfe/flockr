import { CircleCheck, CircleStop, CircleX, LoaderCircle, type LucideIcon } from "lucide-react"
import type { WorkStatus } from "@/lib/work"
import { cn } from "@/lib/utils"

const runGlyph = {
  running: { icon: LoaderCircle, label: "Running" },
  ok: { icon: CircleCheck, label: "Done" },
  error: { icon: CircleX, label: "Failed" },
  stopped: { icon: CircleStop, label: "Stopped" },
} as const satisfies Record<WorkStatus, { icon: LucideIcon; label: string }>

export function StatusGlyph({ status, className }: { status: WorkStatus; className?: string }) {
  const { icon: Icon, label } = runGlyph[status]
  return <Icon aria-label={label} role="img" className={cn("size-3.5 shrink-0", status === "running" && "animate-spin motion-reduce:animate-none", className)} strokeWidth={2} />
}

export const runIcon = (status: WorkStatus): LucideIcon => runGlyph[status].icon
