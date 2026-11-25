import { ArrowRight } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { leadOf } from "@/api/focus"
import { errorText, useAgents, useChannelList, usePostMessage } from "@/api/hooks"
import { openNewAgent } from "@/components/agents/new-agent-store"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function LeadBox({ defaultChannel }: { defaultChannel: string | null }) {
  const agents = useAgents()
  const channels = useChannelList()
  const post = usePostMessage()
  const [text, setText] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const lead = leadOf(agents.data ?? [])
  const list = channels.data ?? []
  const channel = picked ?? (defaultChannel && list.some((c) => c.id === defaultChannel) ? defaultChannel : (list[0]?.id ?? null))

  if (agents.isSuccess && lead === null) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted px-3.5 py-2.5 text-sm">
        <span className="flex-1 text-muted-foreground">No lead agent yet. Make one with the Lead personality to plan goals for you.</span>
        <Button size="sm" variant="outline" onClick={openNewAgent}>
          New agent
        </Button>
      </div>
    )
  }

  const name = lead?.name ?? "lead"
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = text.trim()
    if (!body || channel === null) return
    post.mutate(
      { channel, text: `@${name} ${body}` },
      {
        onSuccess: () => {
          setText("")
          toast(`Sent to ${name} in #${channel}`)
        },
        onError: (error) => toast.error(errorText(error)),
      },
    )
  }

  return (
    <form onSubmit={submit}>
      <InputGroup className="h-11 rounded-xl bg-background">
        <InputGroupAddon>
          <MemberAvatar name={name} size="xs" />
        </InputGroupAddon>
        <InputGroupInput value={text} onChange={(e) => setText(e.target.value)} placeholder={`Tell ${name} what you want`} aria-label={`Message ${name}`} disabled={post.isPending} />
        <InputGroupAddon align="inline-end">
          <Select value={channel ?? undefined} onValueChange={setPicked}>
            <SelectTrigger size="sm" aria-label="Channel" className="border-0 text-muted-foreground shadow-none dark:bg-transparent">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  #{c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <InputGroupButton type="submit" variant="default" size="icon-sm" aria-label="Send" disabled={post.isPending || !text.trim() || channel === null}>
            <ArrowRight />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
