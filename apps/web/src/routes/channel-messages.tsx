import { getRouteApi } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useMessages } from "@/api/hooks"
import { Feed } from "@/components/feed"
import { usePanel } from "@/lib/panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useScrollToEnd } from "@/lib/scroll-end"

const route = getRouteApi("/c/$channel")

export function ChannelMessages() {
  const { channel } = route.useParams()
  const { search, filterLabel } = usePanel()
  const messages = useMessages(channel, search.label)
  const items = messages.data ?? []
  const end = useScrollToEnd(`${channel}:${items.length}`)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="max-w-[880px] px-4 pt-3 pb-2 nav:pl-6">
        {search.label ? (
          <div className="mt-2 mb-2.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>
              Only <b className="font-semibold text-foreground">+{search.label}</b>
            </span>
            <button type="button" onClick={() => filterLabel(undefined)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
              <X className="size-3" />
              Show all
            </button>
          </div>
        ) : (
          <div className="mt-2 mb-2.5 text-center text-xs font-semibold text-faint">Today</div>
        )}
        {search.label && !items.length && <div className="py-6 text-center text-[13px] text-faint">Nothing here carries +{search.label}.</div>}
        <Feed entries={items} />
        <div ref={end} />
      </div>
    </ScrollArea>
  )
}
