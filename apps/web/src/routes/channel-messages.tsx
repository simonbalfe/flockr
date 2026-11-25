import { getRouteApi } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { useChannels, useMembers, useMessages, useTasks } from "@/api/hooks"
import type { FeedItem } from "@/api/types"
import { Feed } from "@/components/feed"
import { CollapsedRun } from "@/components/feed/collapsed-run"
import { quietFeed, type QuietPiece } from "@/components/feed/quiet"
import { FeedStatusProvider, useNeedsYou } from "@/components/feed/status"
import { setFeedMode, useFeedMode } from "@/lib/feed-mode"
import { usePanel } from "@/lib/panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useScrollToEnd } from "@/lib/scroll-end"

const route = getRouteApi("/c/$channel")

const isGone = (item: FeedItem) => item.kind === "text" && item.deleted

function usePieces(channel: string, items: FeedItem[]): QuietPiece[] {
  const mode = useFeedMode()
  const channels = useChannels()
  const members = useMembers()
  const tasks = useTasks()
  const needsYou = useNeedsYou()
  const quiet = mode === "people" && channels.data?.find((c) => c.id === channel)?.kind === "channel"
  const visible = items.filter((item) => !isGone(item))
  if (!quiet || !members.data) return [{ kind: "shown", entries: visible }]
  const kinds = new Map(members.data.map((m) => [m.name, m.kind]))
  return quietFeed(visible, { kindOf: (name) => kinds.get(name), tasks: new Map((tasks.data ?? []).map((t) => [t.id, t])), needsYou })
}

export function ChannelMessages() {
  const { channel } = route.useParams()
  const { search, filterLabel } = usePanel()
  const messages = useMessages(channel, search.label)
  const items = messages.data ?? []
  const pieces = usePieces(channel, items)
  const end = useScrollToEnd(`${channel}:${items.length}`)
  const [jump, setJump] = useState<string | null>(null)

  useEffect(() => {
    if (jump === null) return
    document.querySelector(`[data-entry="${CSS.escape(jump)}"]`)?.scrollIntoView({ block: "center" })
    setJump(null)
  }, [jump])

  const showEverything = (id: string) => {
    setFeedMode("everything")
    setJump(id)
  }

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
        <FeedStatusProvider>
          {pieces.map((piece, i) =>
            piece.kind === "shown" ? (
              <Feed key={piece.entries[0]?.id ?? i} entries={piece.entries} />
            ) : (
              <CollapsedRun key={`hidden-${piece.entries[0]?.id ?? i}`} entries={piece.entries} onOpen={showEverything} />
            ),
          )}
        </FeedStatusProvider>
        <div ref={end} />
      </div>
    </ScrollArea>
  )
}
