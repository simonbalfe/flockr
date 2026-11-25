import { useTasks } from "@/api/hooks"
import { Kanban } from "@/components/kanban"
import { NewTaskDialog } from "@/components/new-task-dialog"
import { PageHeader } from "@/components/page-header"
import { Presence } from "@/components/presence"

export function AllTasks() {
  const tasks = useTasks()
  return (
    <>
      <PageHeader title="All tasks" topic="Every channel">
        <NewTaskDialog />
      </PageHeader>
      <Kanban tasks={tasks.data ?? []} showChannel />
      <div className="px-4 pb-3.5 nav:pl-6">
        <Presence />
      </div>
    </>
  )
}
