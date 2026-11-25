import { getRouteApi, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useEffect } from "react"
import { useChannels, useMarkRead, useTasks } from "@/api/hooks"
import { ChannelRepoDialog } from "@/components/channel-repo-dialog"
import { Composer } from "@/components/composer"
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
  const onTasks = useRouterState({ select: (s) => s.location.pathname.endsWith("/tasks") })
  const current = channels.data?.find((c) => c.id === channel)
  const unread = current?.unread ?? 0
  const open = (tasks.data ?? []).filter((t) => t.channel === channel && t.state !== "done").length

  useEffect(() => {
    if (unread > 0 && !onTasks) markRead.mutate(channel)
  }, [channel, unread, onTasks])

  if (channels.data && !current) {
    return <PageHeader title="Channel not found" topic={`There is no channel called ${channel}`} />
  }

  const showTab = (tab: string) =>
    void navigate({
      to: tab === "tasks" ? "/c/$channel/tasks" : "/c/$channel",
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
        <Tabs value={onTasks ? "tasks" : "messages"} onValueChange={showTab}>
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="tasks">
              Tasks<span className="ml-1 text-faint tabular-nums">{open}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {current && <ChannelRepoDialog channel={channel} repo={current.repo} />}
        {onTasks && <ImportChecklistDialog channel={channel} />}
        {onTasks && <NewTaskDialog channel={channel} />}
      </PageHeader>
      <Outlet />
      <Composer channel={channel} onPosted={() => onTasks && showTab("messages")} />
    </>
  )
}
