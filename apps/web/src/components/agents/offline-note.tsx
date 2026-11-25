import type { Agent } from "@flockr/client"
import { X } from "lucide-react"
import { useState } from "react"
import { useResumeAgent, useStartAgent } from "@/api/agents"
import { useAgents } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { useMayManageAgents } from "./agent-profile"

const unreachable = (agent: Agent) => agent.status === "offline" || agent.status === "error" || agent.status === "paused"

function PausedLine({ agent, editable }: { agent: Agent; editable: boolean }) {
  const resume = useResumeAgent()
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{agent.name} is paused; it answers when resumed.</span>
      {editable && (
        <Button variant="link" size="xs" className="h-auto px-0 text-[12.5px]" onClick={() => resume.mutate(agent.name)} disabled={resume.isPending}>
          Resume it
        </Button>
      )}
    </span>
  )
}

function NoteLine({ agent, editable }: { agent: Agent; editable: boolean }) {
  const start = useStartAgent()
  if (agent.status === "paused") return <PausedLine agent={agent} editable={editable} />
  const startable = editable && agent.config?.desired === "stopped"
  const why = agent.status === "error" ? `${agent.name} cannot work: ${agent.statusReason ?? "the runner reported a problem"}.` : startable ? `${agent.name} is offline.` : `${agent.name} is offline${agent.statusReason ? `: ${agent.statusReason}` : ""}.`
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{why}</span>
      {startable && (
        <Button variant="link" size="xs" className="h-auto px-0 text-[12.5px]" onClick={() => start.mutate(agent.name)} disabled={start.isPending}>
          Start it
        </Button>
      )}
    </span>
  )
}

export function useOfflineMentions() {
  const [names, setNames] = useState<string[]>([])
  return { names, notice: (mentions: string[]) => setNames(mentions), clear: () => setNames([]) }
}

export function OfflineMentionNote({ names, onClear }: { names: string[]; onClear: () => void }) {
  const agents = useAgents()
  const editable = useMayManageAgents()
  const offline = (agents.data ?? []).filter((a) => names.includes(a.name) && a.config !== null && unreachable(a))
  if (!offline.length) return null
  return (
    <div role="status" className="flex items-start gap-2 px-1.5 pt-1.5 text-[12.5px] text-muted-foreground">
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-3">
        {offline.map((agent) => (
          <NoteLine key={agent.name} agent={agent} editable={editable} />
        ))}
      </span>
      <button type="button" aria-label="Dismiss" onClick={onClear} className="text-faint hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
