import type { Channel, ChannelVisibility } from "@flockr/client"
import { useState } from "react"
import { toast } from "sonner"
import { errorText, useMembers } from "@/api/hooks"
import { useAddChannelMember, useChannelMembers, useRemoveChannelMember, useSetReviewNeedsPerson, useSetVisibility } from "@/api/sharing"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const visibilityText = {
  org: { label: "Org", detail: "Everyone in the org sees it" },
  private: { label: "Private", detail: "Only the members listed below" },
  shared: { label: "Shared", detail: "The org, plus members of other orgs listed below" },
} as const satisfies Record<ChannelVisibility, { label: string; detail: string }>

const visibilities: ChannelVisibility[] = ["org", "private", "shared"]

export function ChannelSharingDialog({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false)
  const listed = useChannelMembers(channel.id, open)
  const members = useMembers()
  const setVisibility = useSetVisibility()
  const add = useAddChannelMember()
  const remove = useRemoveChannelMember()
  const review = useSetReviewNeedsPerson()
  const fail = { onError: (error: unknown) => toast(errorText(error)) }
  const names = new Set((listed.data ?? []).map((m) => m.member))
  const addable = (members.data ?? []).filter((m) => !names.has(m.name) && (m.org === channel.org || channel.visibility === "shared"))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {visibilityText[channel.visibility].label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who sees #{channel.id}</DialogTitle>
          <DialogDescription>{visibilityText[channel.visibility].detail}. Owned by org {channel.org}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Select value={channel.visibility} onValueChange={(next) => setVisibility.mutate({ channel: channel.id, visibility: visibilities.find((v) => v === next) ?? channel.visibility }, fail)}>
            <SelectTrigger aria-label="Visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibilities.map((v) => (
                <SelectItem key={v} value={v}>
                  {visibilityText[v].label}: {visibilityText[v].detail}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid gap-1">
            {(listed.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nobody listed.</p>}
            {(listed.data ?? []).map((m) => (
              <div key={m.member} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {m.member}
                  {m.org !== channel.org && <span className="ml-2 text-muted-foreground">{m.org}</span>}
                </span>
                <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate({ channel: channel.id, name: m.member }, fail)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {addable.length > 0 && (
            <Select value="" onValueChange={(name) => add.mutate({ channel: channel.id, name }, fail)}>
              <SelectTrigger aria-label="Add a member">
                <SelectValue placeholder="Add a member" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}
                    {m.org !== channel.org ? ` (${m.org})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Only a person approves tasks
              <span className="block text-[13px] text-muted-foreground">Off: the agent named as reviewer may approve. It never approves its own work.</span>
            </span>
            <Switch
              checked={channel.reviewNeedsPerson}
              disabled={review.isPending}
              onCheckedChange={(next) => review.mutate({ channel: channel.id, reviewNeedsPerson: next }, fail)}
              aria-label="Only a person approves tasks"
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  )
}
