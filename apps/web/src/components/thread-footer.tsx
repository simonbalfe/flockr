import type { TextMessage } from "@/api/types"
import { MemberAvatar } from "@/components/member-avatar"
import { usePanel } from "@/lib/panel"
import { clock } from "@/lib/time"

export function ThreadFooter({ message }: { message: TextMessage }) {
  const { openThread } = usePanel()
  if (message.threadId === null) return null
  const threadId = message.threadId
  const summary = message.thread
  if (!summary) return null
  return (
    <button
      type="button"
      onClick={() => openThread(threadId)}
      className="-ml-1.5 mt-1 inline-flex items-center gap-2 border border-transparent py-[3px] pr-2.5 pl-1.5 text-[12.5px] text-muted-foreground hover:border-border hover:bg-muted"
    >
      <span className="flex gap-0.5">
        {summary.participants.map((name) => (
          <MemberAvatar key={name} name={name} size="xs" />
        ))}
      </span>
      <b className="font-semibold text-foreground">
        {summary.count} {summary.count === 1 ? "reply" : "replies"}
      </b>
      <span className="text-faint tabular-nums">Last reply {clock(summary.lastAt)}</span>
    </button>
  )
}
