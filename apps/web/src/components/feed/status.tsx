import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useInbox, useThread } from "@/api/hooks"
import type { TextMessage } from "@/api/types"
import { messageNeedsYou, threadKeyOf, type NeedsYou } from "@/components/feed/quiet"
import { StateDot } from "@/components/state-dot"
import { Badge } from "@/components/ui/badge"
import { useLiveActivity } from "@/lib/activity"

interface FeedStatus {
  needsYou: NeedsYou
  running: ReadonlySet<string>
}

const FeedStatusContext = createContext<FeedStatus | null>(null)

export function useNeedsYou(): NeedsYou {
  const inbox = useInbox().data
  return useMemo(
    () => ({
      tasks: new Set([...(inbox?.questions ?? []), ...(inbox?.reviews ?? [])].map((task) => task.id)),
      threads: new Set((inbox?.threadQuestions ?? []).map((question) => question.threadId)),
    }),
    [inbox],
  )
}

export function FeedStatusProvider({ children }: { children: ReactNode }) {
  const needsYou = useNeedsYou()
  const runningKey = [...new Set(useLiveActivity().map((a) => a.threadId))].sort().join(" ")
  const value = useMemo(() => ({ needsYou, running: new Set(runningKey ? runningKey.split(" ") : []) }), [needsYou, runningKey])
  return <FeedStatusContext value={value}>{children}</FeedStatusContext>
}

function RunningChip({ threadKey }: { threadKey: string }) {
  const thread = useThread(threadKey)
  const steps = (thread.data?.entries ?? []).reduce((sum, entry) => (entry.kind === "activity" && entry.status === "running" ? sum + entry.parts.length : sum), 0)
  return (
    <Badge variant="secondary">
      <StateDot state="claimed" />
      {steps > 0 ? `running · ${steps} ${steps === 1 ? "step" : "steps"}` : "running"}
    </Badge>
  )
}

export function MessageStatusChips({ message }: { message: TextMessage }) {
  const status = useContext(FeedStatusContext)
  if (!status) return null
  const key = threadKeyOf(message)
  const needsYou = messageNeedsYou(message, status.needsYou)
  const running = key !== null && status.running.has(key)
  if (!needsYou && !running) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {needsYou && <Badge>Needs you</Badge>}
      {running && key !== null && <RunningChip threadKey={key} />}
    </div>
  )
}
