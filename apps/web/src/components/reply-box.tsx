import { useReply } from "@/api/hooks"
import { useWorkingIn } from "@/components/agent/working-line"
import { MessageInput } from "@/components/message-input"
import { currentUser } from "@/api/session"

export function ReplyBox({ threadId }: { threadId: string }) {
  const send = useReply()
  const working = useWorkingIn(threadId).filter((a) => a.member !== currentUser)
  const names = working.map((a) => a.member).join(" and ")
  return (
    <div className="flex-none px-4 pt-1.5 pb-[calc(14px+env(safe-area-inset-bottom))]">
      {working.length > 0 && <div className="px-1 pb-1.5 text-xs text-muted-foreground">Steer: your reply goes to {names} while it works</div>}
      <MessageInput key={threadId} draft={{ kind: "thread", target: threadId }} label={working.length ? "Steer" : "Reply"} placeholder={working.length ? `Steer ${names}` : "Reply"} onSend={(text) => send.mutate({ threadId, text })} />
    </div>
  )
}
