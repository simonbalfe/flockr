import { useAgents, useTasks } from "@/api/hooks"
import { AgentWorkingLine } from "@/components/agent/working-line"
import { useLiveActivity } from "@/lib/activity"
import { usePanel } from "@/lib/panel"
import { useNow } from "@/lib/now"
import { isLowLease, leaseLeft } from "@/lib/task"
import { cn } from "@/lib/utils"

export function WorkingLine({ member }: { member: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <span className="animate-presence size-1.5 bg-foreground" />
      <b className="font-medium text-foreground">{member}</b> is working...
    </span>
  )
}

export function Presence({ channel }: { channel?: string }) {
  const agents = useAgents()
  const tasks = useTasks()
  const activity = useLiveActivity()
  const now = useNow()
  const { openTask, openById } = usePanel()
  const channelOf = new Map((tasks.data ?? []).map((t) => [t.id, t.channel]))
  const working = (agents.data ?? []).filter(
    (a) => a.state === "working" && a.taskId !== null && (channel === undefined || channelOf.get(a.taskId) === channel),
  )
  const live = activity.filter((a) => channel === undefined || a.channel === channel)
  return (
    <div className="flex min-h-5 flex-wrap gap-4 px-1.5 pt-1.5" aria-live="polite">
      {working.map((agent) => (
        <button
          key={agent.name}
          type="button"
          onClick={() => agent.taskId !== null && openTask(agent.taskId)}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <span className="animate-presence size-1.5 bg-foreground" />
          <b className="font-medium text-foreground">{agent.name}</b> #{agent.taskId}
          <span className={cn(isLowLease(agent.leaseExpiresAt, now) && "text-destructive")}>{leaseLeft(agent.leaseExpiresAt, now)} min left</span>
        </button>
      ))}
      {live.map((a) => (
        <span key={`${a.member}:${a.threadId}`} className="inline-flex min-w-0 max-w-full items-center">
          <button type="button" onClick={() => openById(a.threadId)} className="min-w-0 text-left hover:text-foreground">
            <AgentWorkingLine activity={a} />
          </button>
        </span>
      ))}
    </div>
  )
}
