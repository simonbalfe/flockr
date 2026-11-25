import { agentStatusLabels, type AgentStatus } from "@flockr/client"
import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const shape = {
  offline: <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  online: <rect x="0.4" y="0.4" width="7.2" height="7.2" fill="currentColor" />,
  working: <rect x="0.4" y="0.4" width="7.2" height="7.2" fill="currentColor" />,
  paused: (
    <>
      <path d="M2.2 1v6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.8 1v6" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  error: (
    <>
      <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.9 6.1 6.1 1.9" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
} as const satisfies Record<AgentStatus, ReactNode>

const tone = { offline: "text-faint", online: "text-foreground", working: "text-foreground animate-presence", paused: "text-muted-foreground", error: "text-destructive" } as const satisfies Record<AgentStatus, string>

export const statusText = (status: AgentStatus, reason: string | null) => `${agentStatusLabels[status]}${reason && status !== "online" && status !== "working" ? `: ${reason}` : ""}`

export function AgentStatusShape({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <svg viewBox="0 0 8 8" role="img" aria-label={agentStatusLabels[status]} className={cn("size-2 shrink-0", tone[status], className)}>
      {shape[status]}
    </svg>
  )
}

export function AgentStatusDot({ status, reason, className }: { status: AgentStatus; reason: string | null; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-grid", className)}>
          <AgentStatusShape status={status} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{statusText(status, reason)}</TooltipContent>
    </Tooltip>
  )
}
