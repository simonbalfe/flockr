import { getRouteApi } from "@tanstack/react-router"
import { useTasks } from "@/api/hooks"
import { Kanban } from "@/components/kanban"

const route = getRouteApi("/c/$channel")

export function ChannelTasks() {
  const { channel } = route.useParams()
  const tasks = useTasks()
  return <Kanban tasks={(tasks.data ?? []).filter((t) => t.channel === channel)} showChannel={false} />
}
