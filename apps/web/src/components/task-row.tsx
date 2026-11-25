import type { Task } from "@/api/types"
import { ReplyCount } from "@/components/reply-count"
import { StateDot } from "@/components/state-dot"
import { usePanel } from "@/lib/panel"
import { useNow } from "@/lib/now"
import { taskStatus, toneClass } from "@/lib/task"

export function TaskRow({ task, showChannel = false }: { task: Task; showChannel?: boolean }) {
  const { openTask } = usePanel()
  const now = useNow()
  const status = taskStatus(task, now)
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      className="flex w-full items-center gap-2.5 px-3 py-[9px] text-left hover:bg-accent [&:not(:first-child)]:border-t"
    >
      <StateDot state={task.state} />
      <span className="min-w-[26px] font-mono text-xs text-faint">{task.id}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]">
        {task.title}
        {showChannel && <span className="ml-1 text-[12.5px] text-faint">#{task.channel}</span>}
      </span>
      <span className={`text-[12.5px] whitespace-nowrap tabular-nums ${toneClass(status.tone)}`}>{status.text}</span>
      <ReplyCount count={task.replyCount} />
    </button>
  )
}

export function TaskList({ tasks, showChannel }: { tasks: Task[]; showChannel?: boolean }) {
  return (
    <div className="mt-1.5 max-w-[640px] overflow-hidden rounded-[10px] bg-muted">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} showChannel={showChannel} />
      ))}
    </div>
  )
}
