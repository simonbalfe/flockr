import { type FormEvent, type ReactNode, useState } from "react"
import { toast } from "sonner"
import { hideWithUndo, type NeedItem, threadOf } from "@/api/focus"
import { errorText, useAnswerInThread, useAnswerQuestion, useApproveTask, useReply, useRequestChanges, useUnblockTask } from "@/api/hooks"
import type { Task } from "@/api/types"
import { QuestionPrompt } from "@/components/agent/question-prompt"
import { MemberAvatar } from "@/components/member-avatar"
import { StateDot } from "@/components/state-dot"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useNow } from "@/lib/now"
import { usePanel } from "@/lib/panel"
import { useReviewRefusal } from "@/lib/use-task-actions"
import { ago } from "@/lib/time"
import { cn } from "@/lib/utils"

function TaskLine({ task }: { task: Task }) {
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-sm">
      <StateDot state={task.state} />
      <span className="font-mono text-xs text-faint">{task.id}</span>
      <span className="min-w-0 truncate">{task.title}</span>
    </div>
  )
}

function Body({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 max-w-[640px] bg-muted px-3.5 pt-3 pb-3">{children}</div>
}

function OpenThread({ item }: { item: NeedItem }) {
  const { openById } = usePanel()
  return (
    <Button size="sm" variant="ghost" onClick={() => openById(threadOf(item))}>
      Open thread
    </Button>
  )
}

function ReplyForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const reply = useReply()
  const [text, setText] = useState("")
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!text.trim()) return
    reply.mutate(
      { threadId: String(task.id), text: text.trim() },
      {
        onSuccess: () => {
          toast(`Replied on #${task.id}`)
          onDone()
        },
        onError: (error) => toast.error(errorText(error)),
      },
    )
  }
  return (
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to ${task.holder ?? "the thread"}`} aria-label="Reply" autoFocus className="bg-background" />
      <Button type="submit" size="sm" disabled={reply.isPending || !text.trim()} className="h-8">
        Send
      </Button>
    </form>
  )
}

function QuestionBody({ item }: { item: Extract<NeedItem, { kind: "question" }> }) {
  const answer = useAnswerQuestion()
  const question = item.task.question
  if (!question) return null
  return (
    <QuestionPrompt
      question={question}
      pending={false}
      onAnswer={(option) => hideWithUndo({ key: item.key, done: `Answered ${option}`, run: () => answer.mutateAsync({ id: item.task.id, option }) })}
      extra={<OpenThread item={item} />}
    />
  )
}

function ThreadQuestionBody({ item }: { item: Extract<NeedItem, { kind: "threadQuestion" }> }) {
  const answer = useAnswerInThread()
  return (
    <QuestionPrompt
      question={item.entry.question}
      pending={false}
      onAnswer={(option) => hideWithUndo({ key: item.key, done: `Answered ${option}`, run: () => answer.mutateAsync({ threadId: item.entry.threadId, option }) })}
      extra={<OpenThread item={item} />}
    />
  )
}

function ReviewBody({ item }: { item: Extract<NeedItem, { kind: "review" }> }) {
  const approve = useApproveTask()
  const changes = useRequestChanges()
  const { task } = item
  const refused = useReviewRefusal(task, "approve") !== null
  const commits = task.commits.length
  return (
    <Body>
      <div className="text-sm text-muted-foreground">
        Ready for review{task.reviewCommit ? ` at ${task.reviewCommit.slice(0, 7)}` : ""}{commits > 0 ? ` · ${commits} ${commits === 1 ? "commit" : "commits"}` : ""}{task.reviewer ? ` · reviewer ${task.reviewer}` : ""}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!refused && (
          <>
            <Button size="sm" onClick={() => hideWithUndo({ key: item.key, done: `Approved #${task.id}`, run: () => approve.mutateAsync({ id: task.id, commit: task.reviewCommit }) })}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => hideWithUndo({ key: item.key, done: `Sent #${task.id} back to ${task.holder ?? "the holder"}`, run: () => changes.mutateAsync(task.id) })}
            >
              Ask for changes
            </Button>
          </>
        )}
        <OpenThread item={item} />
      </div>
    </Body>
  )
}

function BlockedBody({ item }: { item: Extract<NeedItem, { kind: "blocked" }> }) {
  const unblock = useUnblockTask()
  const [replying, setReplying] = useState(false)
  const { task } = item
  return (
    <Body>
      <div className="text-sm">{task.reason ? `Blocked: ${task.reason}` : "Blocked"}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => hideWithUndo({ key: item.key, done: `Unblocked #${task.id}`, run: () => unblock.mutateAsync(task.id) })}>
          Unblock
        </Button>
        <Button size="sm" variant="outline" aria-expanded={replying} onClick={() => setReplying((open) => !open)}>
          Reply
        </Button>
        <OpenThread item={item} />
      </div>
      {replying && <ReplyForm task={task} onDone={() => setReplying(false)} />}
    </Body>
  )
}

function CardBody({ item }: { item: NeedItem }) {
  switch (item.kind) {
    case "question":
      return <QuestionBody item={item} />
    case "threadQuestion":
      return <ThreadQuestionBody item={item} />
    case "review":
      return <ReviewBody item={item} />
    case "blocked":
      return <BlockedBody item={item} />
    default: {
      const unhandled: never = item
      return unhandled
    }
  }
}

export function NeedCard({ item, focused }: { item: NeedItem; focused: boolean }) {
  const now = useNow()
  const channel = item.kind === "threadQuestion" ? item.entry.channel : item.task.channel
  return (
    <div data-need={item.key} className={cn("grid scroll-my-24 grid-cols-[30px_minmax(0,1fr)] gap-3  px-2 py-3 transition-colors", focused && "bg-accent/60")}>
      {item.who === null ? <span aria-hidden /> : <MemberAvatar name={item.who} />}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {item.who !== null && <span className="text-sm font-semibold">{item.who}</span>}
          <span className="text-xs text-muted-foreground">#{channel}</span>
          <span className="text-xs text-faint">{ago(item.at, now)}</span>
        </div>
        {item.kind !== "threadQuestion" && <TaskLine task={item.task} />}
        <CardBody item={item} />
      </div>
    </div>
  )
}
