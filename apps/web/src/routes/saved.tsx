import { Bookmark } from "lucide-react"
import { toast } from "sonner"
import { errorText, useChannels, useSaved, useUnsaveMessage } from "@/api/hooks"
import { NavList, NavRow } from "@/components/nav-list"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ago } from "@/lib/time"
import { usePanel } from "@/lib/panel"
import { placeOf } from "@/routes/threads"

export function SavedView() {
  const saved = useSaved()
  const channels = useChannels()
  const unsave = useUnsaveMessage()
  const { openById } = usePanel()
  const list = saved.data ?? []
  return (
    <>
      <PageHeader title="Saved items" topic="Messages and replies you kept for later" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">
          <NavList empty={saved.isSuccess && list.length === 0 ? "Nothing saved. Hover a message and press Save." : null}>
            {list.map((item) => (
              <NavRow
                key={item.id}
                who={item.who}
                place={placeOf(channels.data ?? [], item.channel)}
                when={ago(item.at)}
                text={item.deleted ? "Message deleted" : item.text}
                note={`Saved ${ago(item.savedAt)}`}
                onOpen={() => openById(item.threadId)}
                actions={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove from saved"
                    onClick={() => unsave.mutate(item.id, { onError: (error) => toast(errorText(error)) })}
                  >
                    <Bookmark className="fill-current" />
                  </Button>
                }
              />
            ))}
          </NavList>
        </div>
      </ScrollArea>
    </>
  )
}
