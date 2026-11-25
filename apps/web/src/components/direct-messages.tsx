import { Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { errorText, useChannels, useMembers, useOpenDirectMessage } from "@/api/hooks"
import { currentUser } from "@/api/session"
import type { Channel } from "@/api/types"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const rowClass = "flex h-7 w-full items-center gap-[9px] rounded-md px-2 text-left text-[13.5px] hover:bg-accent"

export const otherMember = (channel: Channel) => channel.members.find((m) => m !== currentUser) ?? currentUser

function NewMessage() {
  const members = useMembers()
  const open = useOpenDirectMessage()
  const navigate = useNavigate()
  const people = (members.data ?? []).filter((m) => m.name !== currentUser && (m.kind === "person" || m.kind === "agent"))
  const start = (member: string) =>
    open.mutate(member, {
      onSuccess: (channel) => void navigate({ to: "/c/$channel", params: { channel: channel.id }, search: (prev) => prev }),
      onError: (error) => toast(errorText(error)),
    })
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="New direct message" className="text-faint hover:text-foreground">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>New direct message</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-72 min-w-44">
        <DropdownMenuLabel>Message</DropdownMenuLabel>
        {people.map((member) => (
          <DropdownMenuItem key={member.name} onSelect={() => start(member.name)}>
            <MemberAvatar name={member.name} size="xs" />
            {member.name}
            <span className="ml-auto text-xs text-faint">{member.kind}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DirectMessagesSection() {
  const channels = useChannels()
  const direct = (channels.data ?? []).filter((c) => c.kind === "dm")
  return (
    <div>
      <div className="flex items-center justify-between pr-0.5 pb-1 pl-2">
        <span className="text-[11px] font-semibold text-faint">Direct messages</span>
        <NewMessage />
      </div>
      {direct.map((channel) => (
        <Link
          key={channel.id}
          to="/c/$channel"
          params={{ channel: channel.id }}
          search={(prev) => prev}
          className={cn(rowClass, channel.unread > 0 && "font-semibold")}
          activeProps={{ className: "bg-accent" }}
        >
          <MemberAvatar name={otherMember(channel)} size="xs" />
          <span className="min-w-0 flex-1 truncate">{otherMember(channel)}</span>
          {channel.unread > 0 && <span className="text-xs font-normal text-faint tabular-nums">{channel.unread}</span>}
        </Link>
      ))}
      {direct.length === 0 && <div className="px-2 py-1 text-[12.5px] text-faint">Press + to message a person or an agent.</div>}
    </div>
  )
}
