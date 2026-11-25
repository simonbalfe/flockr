import { MessageSquare, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { mayDeleteMessage } from "@flockr/client"
import { errorText, useDeleteMessage, useMembers } from "@/api/hooks"
import { currentUser } from "@/api/session"
import { usePanel } from "@/lib/panel"
import { cn } from "@/lib/utils"

const reveal = "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
const control =
  "inline-flex items-center gap-1.5 rounded-lg px-2 py-[3px] text-[12.5px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

export function MessageToolbar({ id, who, replyThreadId }: { id: string; who: string; replyThreadId: string | null }) {
  const members = useMembers()
  const remove = useDeleteMessage()
  const { openThread } = usePanel()
  const [confirming, setConfirming] = useState(false)
  const actor = members.data?.find((m) => m.name === currentUser)
  const author = members.data?.find((m) => m.name === who)
  const canDelete = actor !== undefined && mayDeleteMessage({ actor, author: who, authorOwner: author?.owner ?? null })
  if (!canDelete && replyThreadId === null) return null

  const confirm = () =>
    remove.mutate(id, {
      onSuccess: () => setConfirming(false),
      onError: (error) => {
        setConfirming(false)
        toast(errorText(error))
      },
    })

  return (
    <div className={cn("absolute -top-5 right-2 flex items-center gap-0.5 rounded-lg border bg-background p-0.5", confirming ? "opacity-100" : reveal)}>
      {replyThreadId !== null && !confirming && (
        <button type="button" onClick={() => openThread(replyThreadId)} className={control}>
          <MessageSquare className="size-[13px]" />
          Reply in thread
        </button>
      )}
      {canDelete && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className={control} aria-label="Delete message">
          <Trash2 className="size-[13px]" />
          Delete
        </button>
      )}
      {canDelete && confirming && (
        <div role="group" aria-label="Confirm delete" className="flex items-center gap-0.5 text-[12.5px]">
          <span className="px-2 text-muted-foreground">Delete?</span>
          <button type="button" onClick={confirm} disabled={remove.isPending} autoFocus className={cn(control, "font-medium text-foreground")}>
            Yes
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={control}>
            No
          </button>
        </div>
      )}
    </div>
  )
}
