import { answerRefusal } from "@flockr/client"
import { useAnswerInThread, useMembers } from "@/api/hooks"
import { currentUser } from "@/api/session"
import type { Task, ThreadQuestion } from "@/api/types"
import { QuestionPrompt } from "@/components/agent/question-prompt"
import { Button } from "@/components/ui/button"
import { usePanel } from "@/lib/panel"
import { useReviewRefusal, useTaskActions } from "@/lib/use-task-actions"
import { toast } from "sonner"

export function QuestionCard({ task, showDetails = true }: { task: Task; showDetails?: boolean }) {
  const { openTask } = usePanel()
  const actions = useTaskActions()
  const question = task.question
  if (!question) return null
  return (
    <QuestionPrompt
      question={question}
      pending={false}
      onAnswer={(option) => actions.answer(task.id, option)}
      extra={
        showDetails && (
          <Button size="sm" variant="ghost" onClick={() => openTask(task.id)}>
            Details
          </Button>
        )
      }
    />
  )
}

export function ReviewCard({ task }: { task: Task }) {
  const { openTask } = usePanel()
  const actions = useTaskActions()
  const refused = useReviewRefusal(task, "approve") !== null
  return (
    <div className="mt-1.5 max-w-[640px] bg-muted px-3.5 pt-[13px] pb-3">
      <div className="font-semibold">{task.title}</div>
      <div className="mt-[3px] mb-3 text-[13px] text-muted-foreground">
        #{task.id}
        {task.reviewCommit ? ` · in review at ${task.reviewCommit.slice(0, 7)}` : task.commits.length ? ` · ${task.commits.map((c) => c.short).join(", ")}` : ""}
        {task.reviewer ? ` · reviewer ${task.reviewer}` : ""}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!refused && (
          <>
            <Button size="sm" onClick={() => actions.approve(task)}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => actions.requestChanges(task)}>
              Ask for changes
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => openTask(task.id)}>
          Details
        </Button>
      </div>
    </div>
  )
}

export function ThreadQuestionCard({ entry, onDetails }: { entry: ThreadQuestion; onDetails?: () => void }) {
  const answer = useAnswerInThread()
  const { question } = entry
  const members = useMembers()
  const me = members.data?.find((m) => m.name === currentUser)
  const refusal = answerRefusal({ actor: { name: currentUser, kind: me?.kind ?? "person" }, question: { to: entry.to, permission: question.action !== undefined } })
  if (entry.answer !== null) {
    return (
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Answered <b className="font-medium text-foreground">{entry.answer}</b> by {entry.answeredBy ?? "someone"}
      </p>
    )
  }
  if (refusal) {
    return (
      <div className="mt-1.5 max-w-[640px] bg-muted px-3.5 pt-[13px] pb-3">
        <div className="font-semibold">{question.text}</div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">
          For {entry.to ?? "a person"} · {question.options.join(" / ")} · open until {entry.to ?? "a person"} answers
        </div>
      </div>
    )
  }
  return (
    <QuestionPrompt
      question={question}
      pending={answer.isPending}
      onAnswer={(option) => answer.mutate({ threadId: entry.threadId, option }, { onSuccess: () => toast("Answered") })}
      extra={
        onDetails && (
          <Button size="sm" variant="ghost" onClick={onDetails}>
            Details
          </Button>
        )
      }
    />
  )
}
