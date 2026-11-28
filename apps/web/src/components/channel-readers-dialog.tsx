import { listChannelReadersOptions } from "@flockr/client/react-query"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ago } from "@/lib/time"

export function ChannelReadersDialog({ channel, org }: { channel: string; org: string }) {
  const [open, setOpen] = useState(false)
  const readers = useQuery({ ...listChannelReadersOptions({ path: { channel } }), enabled: open })
  const behind = (readers.data ?? []).filter((r) => r.backlog > 0).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Readers
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who has read #{channel}</DialogTitle>
          <DialogDescription>{readers.data ? (behind ? `${behind} behind. Most behind first.` : "Everyone is up to date.") : "Every member who sees the channel, from any org."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {(readers.data ?? []).map((r) => (
            <div key={r.member} className="flex items-center gap-2 text-sm">
              <MemberAvatar name={r.member} size="xs" />
              <span>{r.member}</span>
              {r.org !== org && <span className="text-[12.5px] text-muted-foreground">{r.org}</span>}
              <span className={`ml-auto text-[13px] tabular-nums ${r.backlog ? "" : "text-muted-foreground"}`}>
                {r.backlog ? `${r.backlog} behind${r.behindSince ? `, oldest ${ago(r.behindSince)}` : ""}` : "Up to date"}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
