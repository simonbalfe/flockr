import { Link, useRouterState } from "@tanstack/react-router"
import { ArrowLeft, Bookmark, KeyRound, ListChecks, LogOut, MessagesSquare, Repeat, PanelLeftClose, Search, SendHorizontal, Settings, ShieldCheck, Target, Users } from "lucide-react"
import type { ReactNode } from "react"
import { useSignOut, useWhoami } from "@/api/auth"
import { useNeedsYou } from "@/api/focus"
import { useAgents, useChannels, useDrafts, useMembers, useMyThreads } from "@/api/hooks"
import { ProfileDialog } from "@/components/profile-dialog"
import { currentUser } from "@/api/session"
import type { Agent } from "@/api/types"
import { AgentsHeading } from "@/components/agents/agents-heading"
import { AgentStatusDot } from "@/components/agents/status-dot"
import { NewChannelDialog } from "@/components/new-channel-dialog"
import { DirectMessagesSection } from "@/components/direct-messages"
import { MemberAvatar } from "@/components/member-avatar"
import { useShell } from "@/components/shell-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePanel } from "@/lib/panel"
import { cn } from "@/lib/utils"

const staticRowClass = "flex h-7 w-full items-center gap-[9px]  px-2 text-left text-[13.5px]"
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
        <AgentStatusDot status={agent.status} reason={agent.statusReason} className="absolute -right-[4px] -bottom-[4px] bg-sidebar p-px" />
      </span>
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      <span className="text-xs text-faint tabular-nums">{agent.state === "working" ? `#${agent.taskId}` : ""}</span>
    </button>
  )
}

function SidebarFooter() {
  const me = useWhoami()
  const members = useMembers()
  const signOut = useSignOut()
  const session = me.data?.via === "session"
  const name = me.data?.name ?? currentUser
  const mine = members.data?.find((m) => m.name === name)
  return (
    <div className="flex flex-none items-center gap-1 border-t py-2 pr-2.5 pl-[18px] text-[13.5px]">
      <MemberAvatar name={name} size="xs" />
      {mine ? (
        <ProfileDialog
          member={mine}
          trigger={
            <button type="button" className="ml-[5px] min-w-0 flex-1 truncate text-left hover:underline" aria-label="Edit your profile">
              {mine.displayName ?? name}
            </button>
          }
        />
      ) : (
        <span className="ml-[5px] min-w-0 flex-1 truncate">{name}</span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Settings" asChild>
            <Link to="/settings/routines" search={(prev) => prev}>
              <Settings />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      {session && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Sign out" disabled={signOut.isPending} onClick={() => signOut.mutate({})}>
              <LogOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sign out</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function CollapseSidebar() {
  const { toggleSidebar } = useShell()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="max-nav:hidden" aria-label="Hide sidebar (Cmd+B)" onClick={toggleSidebar}>
          <PanelLeftClose />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Hide sidebar ⌘B</TooltipContent>
    </Tooltip>
  )
}

const settingsLinks = [
  { to: "/settings/routines", label: "Routines", icon: Repeat },
  { to: "/settings/approvals", label: "Approval rules", icon: ShieldCheck },
  { to: "/settings/keys", label: "Keys", icon: KeyRound },
  { to: "/settings/people", label: "People", icon: Users },
] as const

function SettingsSidebar() {
  return (
    <>
      <div className="flex h-[52px] flex-none items-center gap-1 pr-2.5 pl-2.5">
        <Button variant="ghost" size="icon-sm" aria-label="Back to the board" asChild>
          <Link to="/" search={(prev) => prev}>
            <ArrowLeft />
          </Link>
        </Button>
        <span className="flex-1 text-[15px] font-semibold">Settings</span>
        <CollapseSidebar />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid content-start px-2.5 pt-0.5 pb-4" aria-label="Settings">
          {settingsLinks.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <Icon className="size-4 w-[18px]" />
              <span className="flex-1">{label}</span>
            </Link>
          ))}
        </nav>
      </ScrollArea>
      <SidebarFooter />
    </>
  )
}

export function SidebarContent() {
  const inSettings = useRouterState({ select: (state) => state.location.pathname.startsWith("/settings") })
  return inSettings ? <SettingsSidebar /> : <BoardSidebar />
}

function BoardSidebar() {
  const channels = useChannels()
  const agents = useAgents()
  const needs = useNeedsYou()
  const members = useMembers()
  const drafts = useDrafts()
  const threads = useMyThreads()
  const newReplies = (threads.data ?? []).filter((t) => t.unread > 0).length
  const { openPalette } = useShell()
  const waiting = needs.items.length

  return (
    <>
      <div className="flex h-[52px] flex-none items-center justify-between pr-2.5 pl-[18px]">
        <span className="text-[15px] font-semibold">flockr</span>
        <span className="flex items-center">
          <CollapseSidebar />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Search (Cmd+K)" onClick={openPalette}>
                <Search />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search ⌘K</TooltipContent>
          </Tooltip>
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid content-start gap-4 px-2.5 pt-0.5 pb-4" aria-label="Workspace">
          <div>
            <Link to="/" search={(prev) => prev} className={rowClass} activeOptions={{ exact: true }} activeProps={{ className: activeClass }}>
              <Target className="size-4 w-[18px]" />
              <span className="flex-1">Focus</span>
              {waiting > 0 && <Badge className="h-[18px] min-w-[18px] px-1.5 text-[11px] tabular-nums">{waiting}</Badge>}
            </Link>
            <Link to="/threads" search={(prev) => prev} className={cn(rowClass, newReplies > 0 && "font-semibold")} activeProps={{ className: activeClass }}>
              <MessagesSquare className="size-4 w-[18px]" />
              <span className="flex-1">Threads</span>
              {newReplies > 0 && <Badge className="h-[18px] min-w-[18px] px-1.5 text-[11px] tabular-nums">{newReplies}</Badge>}
            </Link>
            <Link to="/saved" search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <Bookmark className="size-4 w-[18px]" />
              <span className="flex-1">Saved items</span>
            </Link>
            <Link to="/drafts" search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <SendHorizontal className="size-4 w-[18px]" />
              <span className="flex-1">Drafts & sent</span>
              {(drafts.data?.length ?? 0) > 0 && <span className="text-xs text-faint tabular-nums">{drafts.data?.length}</span>}
            </Link>
            <Link to="/tasks" search={(prev) => prev} className={rowClass} activeProps={{ className: activeClass }}>
              <ListChecks className="size-4 w-[18px]" />
              <span className="flex-1">All tasks</span>
            </Link>
          </div>
          <div>
            <div className="flex items-center justify-between pr-0.5 pb-1 pl-2">
              <span className="text-[11px] font-semibold text-faint">Channels</span>
              <NewChannelDialog />
            </div>
            {(channels.data ?? []).filter((c) => c.kind === "channel").map((channel) => (
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
          <DirectMessagesSection />
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
      <SidebarFooter />
    </>
  )
}
