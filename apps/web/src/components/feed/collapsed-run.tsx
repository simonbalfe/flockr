import { ChevronRight } from "lucide-react"
import type { FeedItem } from "@/api/types"
import { hiddenRunLabel } from "@/components/feed/quiet"

export function CollapsedRun({ entries, onOpen }: { entries: FeedItem[]; onOpen: (id: string) => void }) {
  const first = entries[0]
  if (!first) return null
  return (
    <div className="pb-1.5 pl-[42px]">
      <button
        type="button"
        onClick={() => onOpen(first.id)}
        className="flex w-full items-center gap-2 bg-muted/60 px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight className="size-3.5" />
        <span className="flex-1">{hiddenRunLabel(entries)}</span>
        <span>Show</span>
      </button>
    </div>
  )
}
