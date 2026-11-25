import { useState } from "react"
import { useChannels, useMyThreads } from "@/api/hooks"
import type { Channel } from "@/api/types"
import { currentUser } from "@/api/session"
import { isDoneThread, statusRank, ThreadRow } from "@/components/feed/thread-row"
import { PageHeader } from "@/components/page-header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ago } from "@/lib/time"
import { usePanel } from "@/lib/panel"

export const placeOf = (channels: Channel[], id: string) => {
  const channel = channels.find((c) => c.id === id)
  return channel?.kind === "dm" ? `with ${channel.members.find((m) => m !== currentUser) ?? currentUser}` : `#${id}`
}

const threadTabs = ["open", "done"] as const
type ThreadTab = (typeof threadTabs)[number]

const emptyText = { open: "Nothing open. Reply to a message to join a thread.", done: "No done threads yet." } as const satisfies Record<ThreadTab, string>

export function ThreadsView() {
  const threads = useMyThreads()
  const channels = useChannels()
  const { openById } = usePanel()
  const [tab, setTab] = useState<ThreadTab>("open")
  const all = threads.data ?? []
  const done = all.filter(isDoneThread)
  const open = all.filter((t) => !isDoneThread(t)).sort((a, b) => statusRank[a.status] - statusRank[b.status])
  const list = tab === "open" ? open : done
  const choose = (value: string) => setTab(threadTabs.find((t) => t === value) ?? "open")
  return (
    <>
      <PageHeader title="Threads">
        <Tabs value={tab} onValueChange={choose}>
          <TabsList>
            <TabsTrigger value="open">
              Open<span className="ml-1 text-faint tabular-nums">{open.length}</span>
            </TabsTrigger>
            <TabsTrigger value="done">
              Done<span className="ml-1 text-faint tabular-nums">{done.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">
          {threads.isSuccess && list.length === 0 ? (
            <div className="px-1 py-6 text-[13px] text-faint">{emptyText[tab]}</div>
          ) : (
            <ul className="grid">
              {list.map((thread) => (
                <ThreadRow
                  key={thread.threadId}
                  thread={thread}
                  place={placeOf(channels.data ?? [], thread.channel)}
                  when={ago(thread.lastAt)}
                  showChip={tab === "open"}
                  onOpen={() => openById(thread.threadId)}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
