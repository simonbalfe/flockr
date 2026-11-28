import type { Task } from "@/api/types"
import { MemberAvatar } from "@/components/member-avatar"
import { ReplyCount } from "@/components/reply-count"
import { StateDot } from "@/components/state-dot"
import { usePanel } from "@/lib/panel"
import { useNow } from "@/lib/now"
import { kanbanLanes, laneOf, stateLabel, taskStatus, toneClass } from "@/lib/task"

function TaskCard({ task, showChannel }: { task: Task; showChannel: boolean }) {
  const { openTask } = usePanel()
  const now = useNow()
  const status = taskStatus(task, now)
  const who = task.holder ?? task.assignee
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      className="grid w-full gap-2 border bg-background px-[11px] py-2.5 text-left shadow-xs hover:border-faint"
    >
      <span className="flex h-[18px] items-center gap-2">
        <span className="font-mono text-xs text-faint">{task.id}</span>
        {showChannel && <span className="text-[12.5px] text-faint">#{task.channel}</span>}
        <span className="ml-auto">
          <ReplyCount count={task.replyCount} />
        </span>
      </span>
      <span className="text-[13.5px] leading-[1.35] font-medium text-pretty [overflow-wrap:anywhere]">{task.title}</span>
      <span className="grid gap-1">
        {who ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <MemberAvatar name={who} size="xs" />
            <span className="truncate">{who}</span>
          </span>
        ) : (
          <span className="text-[13px] text-faint">Unassigned</span>
        )}
        <span className={`text-xs tabular-nums ${toneClass(status.tone)}`}>{status.text}</span>
      </span>
    </button>
  )
}

export function Kanban({ tasks, showChannel }: { tasks: Task[]; showChannel: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="grid min-h-full grid-cols-[repeat(6,minmax(140px,1fr))] items-stretch gap-2.5 px-4 py-4 nav:pl-6">
        {kanbanLanes.map((state) => {
          const items = tasks.filter((t) => laneOf[t.state] === state)
          return (
            <section key={state} className="flex min-w-0 flex-col gap-2 border bg-sidebar px-2 py-2.5" aria-label={stateLabel[state]}>
              <div className="flex items-center gap-2 px-1 text-[12.5px] font-medium text-muted-foreground">
                <StateDot state={state} />
                <span>{stateLabel[state]}</span>
                <span className="ml-auto font-normal text-faint tabular-nums">{items.length}</span>
              </div>
              <div className="grid content-start gap-2">
                {items.map((task) => (
                  <TaskCard key={task.id} task={task} showChannel={showChannel} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
