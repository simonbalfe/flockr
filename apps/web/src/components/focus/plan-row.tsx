import { ChevronRight } from "lucide-react"
import { useState } from "react"
import { type Plan, usePlan } from "@/api/focus"
import { MemberAvatar } from "@/components/member-avatar"
import { TaskList } from "@/components/task-row"
import { cn } from "@/lib/utils"

function progressText(plan: Plan): string {
  const { done, total, blocked } = plan.progress
  return [`${done} of ${total} done`, blocked > 0 ? `${blocked} blocked` : null].filter((part) => part !== null).join(" · ")
}

function PlanTasks({ id }: { id: number }) {
  const plan = usePlan(id)
  if (plan.isPending) return <div className="px-3 py-2 text-sm text-faint">Loading tasks</div>
  if (plan.isError) return <div className="px-3 py-2 text-sm text-muted-foreground">Could not load this plan. Close it and open it again.</div>
  if (plan.data.tasks.length === 0) return <div className="px-3 py-2 text-sm text-faint">No tasks in this plan yet.</div>
  return <TaskList tasks={plan.data.tasks} />
}

export function PlanRow({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false)
  const { done, total } = plan.progress
  const share = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        <MemberAvatar name={plan.createdBy} size="xs" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{plan.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {plan.createdBy} · #{plan.channel} · {progressText(plan)}
          </span>
        </span>
        <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted max-sm:w-12" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${plan.title} progress`}>
          <span className="block h-full rounded-full bg-foreground" style={{ width: `${share}%` }} />
        </span>
      </button>
      {open && (
        <div className="pb-2 pl-9">
          <PlanTasks id={plan.id} />
        </div>
      )}
    </div>
  )
}
