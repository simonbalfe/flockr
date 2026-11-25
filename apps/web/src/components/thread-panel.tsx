import { splitSubThreads } from "@flockr/client"
import { useLiveActivity } from "@/lib/activity"
import { useMakeTaskFromThread, useThread } from "@/api/hooks"
import { ChatItem } from "@/components/agent/chat-scroll"
import { AgentWorkingLine, ThreadWorking } from "@/components/agent/working-line"
import { Feed } from "@/components/feed"
import { PanelFrame } from "@/components/panel-frame"
import { ReplyBox } from "@/components/reply-box"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ListPlus } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import type { Thread } from "@/api/types"
import { usePanel } from "@/lib/panel"
import { toast } from "sonner"

export function ThreadEntries({ entries }: { entries: Thread["entries"] }) {
  const { top, under } = splitSubThreads(entries)
  return <Feed entries={top} inThread subThreads={under} />
}

export function ThreadPanel({ id }: { id: string }) {
  const thread = useThread(id)
  const make = useMakeTaskFromThread()
  const { openTask } = usePanel()
  const current = thread.data
  const working = useLiveActivity().filter((a) => a.threadId === id)
  const count = current?.entries.length ?? 0

  const makeTask = () =>
    make.mutate(id, {
      onSuccess: (task) => {
        toast(`Made #${task.id} from the thread`)
        openTask(task.id)
      },
    })

  return (
    <PanelFrame
      title={
        <>
          <span className="text-[13.5px] font-semibold">Thread</span>
          {current && <span className="text-[12.5px] text-muted-foreground">#{current.channel}</span>}
          <span className="ml-auto min-w-0 self-center">
            <ThreadWorking threadId={id} compact />
          </span>
          {current?.root && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Make this thread a task" className="text-faint hover:text-foreground" onClick={makeTask} disabled={make.isPending}>
                  <ListPlus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Make this thread a task</TooltipContent>
            </Tooltip>
          )}
        </>
      }
      footer={<ReplyBox threadId={id} />}
      chat
    >
      {current && (
        <ChatItem className="px-5 pt-4 pb-2">
          {current.root && <Feed entries={[current.root]} inThread />}
          <Separator className="my-2" />
          <div className="mb-1 text-[13px] font-semibold text-muted-foreground">
            {count} {count === 1 ? "reply" : "replies"}
          </div>
          {count ? <ThreadEntries entries={current.entries} /> : <div className="px-1 py-2 text-[13px] text-faint">No replies yet.</div>}
          {working.map((a) => (
            <div key={a.member} className="px-1 py-1.5">
              <AgentWorkingLine activity={a} />
            </div>
          ))}
        </ChatItem>
      )}
    </PanelFrame>
  )
}

