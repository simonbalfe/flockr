import { getRouteApi } from "@tanstack/react-router"
import { useMessages } from "@/api/hooks"
import { Feed } from "@/components/feed"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useScrollToEnd } from "@/lib/scroll-end"

const route = getRouteApi("/c/$channel")

export function ChannelMessages() {
  const { channel } = route.useParams()
  const messages = useMessages(channel)
  const items = messages.data ?? []
  const end = useScrollToEnd(`${channel}:${items.length}`)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="max-w-[880px] px-4 pt-3 pb-2 nav:pl-6">
        <div className="mt-2 mb-2.5 text-center text-xs font-semibold text-faint">Today</div>
        <Feed entries={items} />
        <div ref={end} />
      </div>
    </ScrollArea>
  )
}
