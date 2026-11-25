import { useTask, useTasks, useThread } from "@/api/hooks"
import { AddCommitDialog } from "@/components/add-commit-dialog"
import { CommitLinksProvider, CommitSha } from "@/components/commit-link"
import { MemberAvatar } from "@/components/member-avatar"
import { KeyValueList, PanelFrame, PanelHeading } from "@/components/panel-frame"
import { ChatItem } from "@/components/agent/chat-scroll"
import { AgentWorkingLine, ThreadWorking } from "@/components/agent/working-line"
import { QuestionCard } from "@/components/question-card"
import { ReplyBox } from "@/components/reply-box"
import { StateDot } from "@/components/state-dot"
import { TaskActions } from "@/components/task-actions"
import { ThreadEntries } from "@/components/thread-panel"
import { useLiveActivity } from "@/lib/activity"
import { usePanel } from "@/lib/panel"
import { useNow } from "@/lib/now"
import { stateLabel, taskStatus, toneClass } from "@/lib/task"

export function TaskPanel({ id }: { id: number }) {
  const task = useTask(id)
  const thread = useThread(String(id))
  const tasks = useTasks()
  const { openTask } = usePanel()
  const now = useNow()
  const working = useLiveActivity().filter((a) => a.threadId === String(id))
  const current = task.data
  if (!current) return <PanelFrame title={<span className="font-mono text-xs text-faint">#{id}</span>}>{null}</PanelFrame>

  const status = taskStatus(current, now)
  const byId = new Map((tasks.data ?? []).map((t) => [t.id, t]))
  const person = current.holder ?? current.assignee
  const rows: { label: string; value: React.ReactNode }[] = []
  if (person) {
    rows.push({
      label: current.holder ? "Holder" : "For",
      value: (
        <>
          <MemberAvatar name={person} size="xs" />
          {person}
        </>
      ),
    })
  }
  if (current.needs.length) {
    rows.push({
      label: "Needs",
      value: current.needs.map((n) => {
        const needed = byId.get(n)
        return (
          <span key={n} className="inline-flex items-center gap-1.5">
            {needed && <StateDot state={needed.state} />}
            <button type="button" onClick={() => openTask(n)} className="underline decoration-accent underline-offset-[3px] hover:decoration-foreground">
              #{n}
            </button>
          </span>
        )
      }),
    })
  }
  if (current.reason) rows.push({ label: "Reason", value: <span className="text-destructive">{current.reason}</span> })
  if (current.spec) rows.push({ label: "Spec", value: <span className="font-mono text-[12.5px]">{current.spec}</span> })
  if (current.commits.length) {
    rows.push({ label: current.commits.length === 1 ? "Commit" : "Commits", value: current.commits.map((c) => <CommitSha key={c.sha} commit={c} />) })
  }
  rows.push({ label: "Kind", value: current.kind })

  const showStatus = (current.state === "claimed" || current.state === "waiting" || current.state === "ready") && status.text !== stateLabel[current.state]

  return (
    <PanelFrame
      title={
        <>
          <span className="font-mono text-xs text-faint">#{id}</span>
          <span className="text-[12.5px] text-muted-foreground">#{current.channel}</span>
          <span className="ml-auto min-w-0 self-center">
            <ThreadWorking threadId={String(id)} compact />
          </span>
        </>
      }
      footer={<ReplyBox threadId={String(id)} />}
      chat
    >
      <ChatItem className="grid gap-3 px-5 pt-[18px] pb-1.5">
        <h2 className="text-lg leading-[1.3] font-semibold tracking-[-0.01em] text-balance">{current.title}</h2>
        <div className="flex flex-wrap items-center gap-[7px] text-[13px] text-muted-foreground">
          <StateDot state={current.state} />
          <span>{stateLabel[current.state]}</span>
          {showStatus && (
            <>
              <span>·</span>
              <span className={toneClass(status.tone)}>{status.text}</span>
            </>
          )}
        </div>
        <KeyValueList rows={rows} />
        {current.question && current.state === "claimed" && <QuestionCard task={current} showDetails={false} />}
        <div className="flex flex-wrap items-center gap-2">
          <TaskActions task={current} />
          <AddCommitDialog taskId={id} />
        </div>
      </ChatItem>
      <ChatItem>
        <PanelHeading>Replies</PanelHeading>
      </ChatItem>
      <ChatItem className="px-5 pb-2">
        <CommitLinksProvider commits={current.commits}>
          {thread.data?.entries.length ? <ThreadEntries entries={thread.data.entries} /> : <div className="px-1 py-2 text-[13px] text-faint">No replies yet.</div>}
        </CommitLinksProvider>
        {working.map((a) => (
          <div key={a.member} className="px-1 py-1.5">
            <AgentWorkingLine activity={a} />
          </div>
        ))}
      </ChatItem>
    </PanelFrame>
  )
}
