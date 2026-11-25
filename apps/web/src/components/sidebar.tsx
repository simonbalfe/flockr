import { Link } from "@tanstack/react-router"
import { Inbox, ListChecks, Repeat, Search } from "lucide-react"
import type { ReactNode } from "react"
import { useAgents, useChannels, useInbox, useMembers } from "@/api/hooks"
import { currentUser } from "@/api/session"
import type { Agent } from "@/api/types"
import { AgentsHeading } from "@/components/agents/agents-heading"
import { AgentStatusDot } from "@/components/agents/status-dot"
import { MemberAvatar } from "@/components/member-avatar"
import { useShell } from "@/components/shell-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePanel } from "@/lib/panel"
import { cn } from "@/lib/utils"

const staticRowClass = "flex h-7 w-full items-center gap-[9px] rounded-md px-2 text-left text-[13.5px]"
const rowClass = `${staticRowClass} hover:bg-accent`
const activeClass = "bg-accent"

function GroupHeading({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 text-[11px] font-semibold text-faint">{children}</div>
}

function AgentRow({ agent }: { agent: Agent }) {
  const { openAgent, search } = usePanel()
  return (
    <button type="button" onClick={() => openAgent(agent.name)} className={cn(rowClass, search.agent === agent.name && activeClass)}>
      <span className="relative inline-grid">
        <MemberAvatar name={agent.name} size="xs" />
        <AgentStatusDot status={agent.status} reason={agent.statusReason} className="absolute -right-[4px] -bottom-[4px] rounded-full bg-sidebar p-px" />
      </span>
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      <span className="text-xs text-faint tabular-nums">{agent.state === "working" ? `#${agent.taskId}` : ""}</span>
    </button>
  )
}

export function SidebarContent() {
  const channels = useChannels()
  const agents = useAgents()
  const inbox = useInbox()
  const members = useMembers()
  const { openPalette } = useShell()
  const waiting = (inbox.data?.questions.length ?? 0) + (inbox.data?.reviews.length ?? 0)

  return (
    <>
      <div className="flex h-[52px] flex-none items-center justify-between pr-2.5 pl-[18px]">
        <span className="text-[15px] font-semibold">flockr</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Search (Cmd+K)" onClick={openPalette}>
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search ⌘K</TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid content-start gap-4 px-2.5 pt-0.5 pb-4" aria-label="Workspace">
          <div>
            <Link to="/inbox" search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <Inbox className="size-4 w-[18px]" />
              <span className="flex-1">Waiting for you</span>
              {waiting > 0 && <Badge className="h-[18px] min-w-[18px] rounded-full px-1.5 text-[11px] tabular-nums">{waiting}</Badge>}
            </Link>
            <Link to="/tasks" search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <ListChecks className="size-4 w-[18px]" />
              <span className="flex-1">All tasks</span>
            </Link>
            <Link to="/routines" search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <Repeat className="size-4 w-[18px]" />
              <span className="flex-1">Routines</span>
            </Link>
          </div>
          <div>
            <GroupHeading>Channels</GroupHeading>
            {(channels.data ?? []).map((channel) => (
              <Link
                key={channel.id}
                to="/c/$channel"
                params={{ channel: channel.id }}
                search={(prev) => prev}
                className={cn(rowClass, channel.unread > 0 && "font-semibold")}
                activeProps={{ className: activeClass }}
              >
                <span className="w-[18px] text-center font-medium text-faint">#</span>
                <span className="min-w-0 flex-1 truncate">{channel.id}</span>
                {channel.unread > 0 && <span className="text-xs font-normal text-faint tabular-nums">{channel.unread}</span>}
              </Link>
            ))}
          </div>
          <div>
            <AgentsHeading />
            {(agents.data ?? []).map((agent) => (
              <AgentRow key={agent.name} agent={agent} />
            ))}
          </div>
          <div>
            <GroupHeading>People</GroupHeading>
            {(members.data ?? [])
              .filter((m) => m.kind === "person")
              .map((person) => (
                <div key={person.name} className={staticRowClass}>
                  <MemberAvatar name={person.name} size="xs" />
                  <span className="flex-1">{person.name}</span>
                  {person.name === currentUser && <span className="text-xs text-faint">you</span>}
                </div>
              ))}
          </div>
        </nav>
      </ScrollArea>
    </>
  )
}
