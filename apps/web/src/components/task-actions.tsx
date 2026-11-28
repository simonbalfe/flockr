import { useState, type FormEvent, type KeyboardEvent } from "react"
import { useAgents } from "@/api/hooks"
import type { Task } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useReviewRefusal, useTaskActions } from "@/lib/use-task-actions"

type Asking = "block" | "cancel"

const asks = {
  block: { verb: "Block", placeholder: "Why is it blocked?" },
  cancel: { verb: "Cancel task", placeholder: "Why is it no longer needed?" },
} as const satisfies Record<Asking, { verb: string; placeholder: string }>

function ReasonForm({ task, asking, onDone }: { task: Task; asking: Asking; onDone: () => void }) {
  const actions = useTaskActions()
  const [reason, setReason] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (asking === "block") actions.block(task.id, reason)
    else actions.cancel(task.id, reason)
    onDone()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2">
      <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={onKeyDown} placeholder={asks[asking].placeholder} aria-label="Reason" />
      <Button type="submit" variant="secondary">
        {asks[asking].verb}
      </Button>
    </form>
  )
}

export function TaskActions({ task }: { task: Task }) {
  const actions = useTaskActions()
  const agents = useAgents()
  const [asking, setAsking] = useState<Asking | null>(null)
  const approveRefusal = useReviewRefusal(task, "approve")
  const changesRefusal = useReviewRefusal(task, "changes")
  const helper = agents.data?.[0]?.name

  if (asking) return <ReasonForm task={task} asking={asking} onDone={() => setAsking(null)} />

  const hint = (text: string) => <span className="text-[13px] text-muted-foreground">{text}</span>
  const blockButton = (
    <Button variant="outline" onClick={() => setAsking("block")}>
      Block
    </Button>
  )
  const cancelButton = (
    <Button variant="ghost" onClick={() => setAsking("cancel")}>
      Cancel task
    </Button>
  )

  switch (task.state) {
    case "ready":
      return (
        <>
          <Button onClick={() => actions.claim(task.id)}>Claim</Button>
          {!task.assignee && helper && (
            <Button variant="secondary" onClick={() => actions.give(task.id, helper)}>
              Give to {helper}
            </Button>
          )}
          {blockButton}
          {cancelButton}
        </>
      )
    case "claimed":
      return (
        <>
          {!task.question && (task.reviewer ? <Button onClick={() => actions.submit(task.id)}>Send to {task.reviewer}</Button> : <Button onClick={() => actions.complete(task.id)}>Mark done</Button>)}
          <Button variant="secondary" onClick={() => actions.release(task.id)}>
            Release
          </Button>
          {blockButton}
          {cancelButton}
        </>
      )
    case "blocked":
      return (
        <>
          <Button onClick={() => actions.unblock(task.id)}>Unblock</Button>
          {cancelButton}
        </>
      )
    case "failed":
      return (
        <>
          <Button onClick={() => actions.reopen(task.id)}>Reopen</Button>
          {cancelButton}
        </>
      )
    case "canceled":
      return <Button variant="secondary" onClick={() => actions.reopen(task.id)}>Reopen</Button>
    case "review":
      if (approveRefusal && changesRefusal) return hint(`Waiting for ${task.reviewer ?? "a person"} to review${task.reviewCommit ? ` ${task.reviewCommit.slice(0, 7)}` : ""}.`)
      return (
        <>
          {!approveRefusal && <Button onClick={() => actions.approve(task)}>{task.reviewCommit ? `Approve ${task.reviewCommit.slice(0, 7)}` : "Approve"}</Button>}
          {!changesRefusal && (
            <Button variant="secondary" onClick={() => actions.requestChanges(task)}>
              Ask for changes
            </Button>
          )}
        </>
      )
    case "waiting":
      return (
        <>
          {hint(`Starts by itself when ${task.needs.map((n) => `#${n}`).join(", ")} ${task.needs.length > 1 ? "are" : "is"} done.`)}
          {cancelButton}
        </>
      )
    case "done":
      return hint(`Completed${task.commits.length ? ` in ${task.commits.map((c) => c.short).join(", ")}` : ""}.`)
  }
}
