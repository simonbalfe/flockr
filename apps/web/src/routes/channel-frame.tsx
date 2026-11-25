import { getRouteApi, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useEffect } from "react"
import { usePanel } from "@/lib/panel"
import { Button } from "@/components/ui/button"
import { useAreas, useChannels, useMarkRead, useTasks } from "@/api/hooks"
import { currentUser } from "@/api/session"
import { MemberAvatar } from "@/components/member-avatar"
import { ChannelRepoDialog } from "@/components/channel-repo-dialog"
import { Composer } from "@/components/composer"
import { DeclareAreaDialog } from "@/components/declare-area-dialog"
import { ImportChecklistDialog } from "@/components/import-checklist-dialog"
import { NewTaskDialog } from "@/components/new-task-dialog"
import { PageHeader } from "@/components/page-header"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const route = getRouteApi("/c/$channel")

export function ChannelFrame() {
  const { channel } = route.useParams()
  const channels = useChannels()
  const tasks = useTasks()
  const markRead = useMarkRead()
  const navigate = useNavigate()
  const { openMemory } = usePanel()
  const onTasks = useRouterState({ select: (s) => s.location.pathname.endsWith("/tasks") })
  const onAreas = useRouterState({ select: (s) => s.location.pathname.endsWith("/areas") })
  const areas = useAreas(channel)
  const current = channels.data?.find((c) => c.id === channel)
  const unread = current?.unread ?? 0
  const open = (tasks.data ?? []).filter((t) => t.channel === channel && t.state !== "done").length

  useEffect(() => {
    if (unread > 0 && !onTasks && !onAreas) markRead.mutate(channel)
  }, [channel, unread, onTasks])

  if (channels.data && !current) {
    return <PageHeader title="Channel not found" topic={`There is no channel called ${channel}`} />
  }

  const tabPath = { tasks: "/c/$channel/tasks", areas: "/c/$channel/areas", messages: "/c/$channel" } as const

  if (current?.kind === "dm") {
    const other = current.members.find((m) => m !== currentUser) ?? currentUser
    return (
      <>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <MemberAvatar name={other} size="xs" />
              {other}
            </span>
          }
          topic="Direct message: only the two of you can read this"
        />
        <Outlet />
        <Composer channel={channel} placeholder={`Message ${other}`} onPosted={() => undefined} />
      </>
    )
  }

  const showTab = (tab: string) =>
    void navigate({
      to: tab === "tasks" || tab === "areas" ? tabPath[tab] : tabPath.messages,
      params: { channel },
      search: (prev) => prev,
    })

  return (
    <>
      <PageHeader
        title={
          <>
            <span className="mr-0.5 font-medium text-faint">#</span>
            {channel}
          </>
        }
        topic={current?.topic}
      >
        <Tabs value={onTasks ? "tasks" : onAreas ? "areas" : "messages"} onValueChange={showTab}>
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="tasks">
              Tasks<span className="ml-1 text-faint tabular-nums">{open}</span>
            </TabsTrigger>
            <TabsTrigger value="areas">
              Areas<span className="ml-1 text-faint tabular-nums">{areas.data?.length ?? 0}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" onClick={() => openMemory(channel)}>
          Memory
        </Button>
        {current && <ChannelRepoDialog channel={channel} repo={current.repo} />}
        {onTasks && <ImportChecklistDialog channel={channel} />}
        {onTasks && <NewTaskDialog channel={channel} />}
        {onAreas && <DeclareAreaDialog channel={channel} />}
      </PageHeader>
      <Outlet />
      <Composer channel={channel} placeholder={`Message #${channel}`} onPosted={() => (onTasks || onAreas) && showTab("messages")} />
    </>
  )
}
