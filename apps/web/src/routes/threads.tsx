import { useChannels, useMyThreads } from "@/api/hooks"
import type { Channel } from "@/api/types"
import { currentUser } from "@/api/session"
import { NavList, NavRow } from "@/components/nav-list"
import { PageHeader } from "@/components/page-header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ago } from "@/lib/time"
import { usePanel } from "@/lib/panel"

export const placeOf = (channels: Channel[], id: string) => {
  const channel = channels.find((c) => c.id === id)
  return channel?.kind === "dm" ? `with ${channel.members.find((m) => m !== currentUser) ?? currentUser}` : `#${id}`
}

export function ThreadsView() {
  const threads = useMyThreads()
  const channels = useChannels()
  const { openById } = usePanel()
  const list = threads.data ?? []
  return (
    <>
      <PageHeader title="Threads" topic="Every thread you started or replied in" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">
          <NavList empty={threads.isSuccess && list.length === 0 ? "No threads yet. Reply to a message to join one." : null}>
            {list.map((thread) => (
              <NavRow
                key={thread.threadId}
                who={thread.lastWho}
                place={placeOf(channels.data ?? [], thread.channel)}
                when={ago(thread.lastAt)}
                text={thread.lastText}
                note={`${thread.title}  ·  ${thread.replies} ${thread.replies === 1 ? "reply" : "replies"}`}
                unread={thread.unread}
                onOpen={() => openById(thread.threadId)}
              />
            ))}
          </NavList>
        </div>
      </ScrollArea>
    </>
  )
}
