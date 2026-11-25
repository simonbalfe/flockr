import { currentStep } from "@flockr/client"
import { Square } from "lucide-react"
import { useStopRun, useThread } from "@/api/hooks"
import type { Activity } from "@/api/types"
import { useClock } from "@/components/agent/use-clock"
import { Button } from "@/components/ui/button"
import { useLiveActivity } from "@/lib/activity"
import { duration, latestRunning } from "@/lib/work"
import { toast } from "sonner"

export function useWorkingIn(threadId: string): Activity[] {
  return useLiveActivity().filter((a) => a.threadId === threadId)
}

export function AgentWorkingLine({ activity, stop = false }: { activity: Activity; stop?: boolean }) {
  const thread = useThread(activity.threadId)
  const entry = latestRunning(thread.data?.entries.flatMap((e) => (e.kind === "activity" ? [e] : [])) ?? [], activity.member)
  const now = useClock(true)
  const halt = useStopRun()
  const step = entry ? currentStep(entry) : null
  const since = Date.parse(entry?.at ?? activity.since)
  const stopping = entry?.stopRequestedAt !== null && entry?.stopRequestedAt !== undefined

  const onStop = () =>
    halt.mutate(
      { threadId: activity.threadId, member: activity.member },
      { onSuccess: () => toast(`Asked ${activity.member} to stop`), onError: () => toast(`Could not ask ${activity.member} to stop`) },
    )

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <span className="animate-presence size-1.5 shrink-0 rounded-full bg-foreground" />
      <span className="min-w-0 truncate">
        <b className="font-medium text-foreground">{activity.member}</b> is working
        {entry && step && step !== entry.title ? (
          <>
            {" "}
            on {entry.title} <span className="shimmer motion-reduce:shimmer-none">· {step}</span>
          </>
        ) : entry ? (
          ` on ${entry.title}`
        ) : (
          "..."
        )}
      </span>
      <span className="shrink-0 tabular-nums">· {duration(now - since)}</span>
      {stop &&
        (stopping ? (
          <span className="shrink-0">· stopping</span>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            className="h-6 shrink-0 gap-1 px-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
            disabled={halt.isPending}
            onClick={(event) => {
              event.stopPropagation()
              onStop()
            }}
          >
            <Square className="size-3 fill-current" />
            Stop
          </Button>
        ))}
    </span>
  )
}

function CompactWorking({ activity }: { activity: Activity }) {
  const halt = useStopRun()
  const thread = useThread(activity.threadId)
  const entry = latestRunning(thread.data?.entries.flatMap((e) => (e.kind === "activity" ? [e] : [])) ?? [], activity.member)
  const stopping = entry !== undefined && entry.stopRequestedAt !== null
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <span className="animate-presence size-1.5 shrink-0 rounded-full bg-foreground" />
      <b className="min-w-0 truncate font-medium text-foreground">{activity.member}</b>
      {stopping ? (
        <span className="shrink-0">stopping</span>
      ) : (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={halt.isPending}
          onClick={() =>
            halt.mutate(
              { threadId: activity.threadId, member: activity.member },
              { onSuccess: () => toast(`Asked ${activity.member} to stop`), onError: () => toast(`Could not ask ${activity.member} to stop`) },
            )
          }
        >
          <Square className="size-2.5 fill-current" />
          Stop
        </Button>
      )}
    </span>
  )
}

export function ThreadWorking({ threadId, stop = true, compact = false }: { threadId: string; stop?: boolean; compact?: boolean }) {
  const working = useWorkingIn(threadId)
  if (!working.length) return null
  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-3" aria-live="polite">
        {working.map((a) => (
          <CompactWorking key={a.member} activity={a} />
        ))}
      </span>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5" aria-live="polite">
      {working.map((a) => (
        <AgentWorkingLine key={a.member} activity={a} stop={stop} />
      ))}
    </div>
  )
}
