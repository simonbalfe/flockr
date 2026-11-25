import { useState, type FormEvent, type KeyboardEvent } from "react"
import { useAgents } from "@/api/hooks"
import type { Task } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTaskActions } from "@/lib/use-task-actions"

function BlockForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const actions = useTaskActions()
  const [reason, setReason] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    actions.block(task.id, reason)
    onDone()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2">
      <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={onKeyDown} placeholder="Why is it blocked?" aria-label="Reason" />
      <Button type="submit" variant="secondary">
        Block
      </Button>
    </form>
  )
}

export function TaskActions({ task }: { task: Task }) {
  const actions = useTaskActions()
  const agents = useAgents()
  const [blocking, setBlocking] = useState(false)
  const helper = agents.data?.[0]?.name

  if (blocking) return <BlockForm task={task} onDone={() => setBlocking(false)} />

  const hint = (text: string) => <span className="text-[13px] text-muted-foreground">{text}</span>
  const blockButton = (
    <Button variant="outline" onClick={() => setBlocking(true)}>
      Block
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
        </>
      )
    case "claimed":
      return (
        <>
          {!task.question && <Button onClick={() => actions.complete(task.id)}>Mark done</Button>}
          <Button variant="secondary" onClick={() => actions.release(task.id)}>
            Release
          </Button>
          {blockButton}
        </>
      )
    case "blocked":
      return <Button onClick={() => actions.unblock(task.id)}>Unblock</Button>
    case "review":
      return (
        <>
          <Button onClick={() => actions.approve(task.id)}>Approve</Button>
          <Button variant="secondary" onClick={() => actions.requestChanges(task)}>
            Ask for changes
          </Button>
        </>
      )
    case "waiting":
      return hint(`Starts by itself when ${task.needs.map((n) => `#${n}`).join(", ")} ${task.needs.length > 1 ? "are" : "is"} done.`)
    case "done":
      return hint(`Completed${task.commit ? ` in ${task.commit}` : ""}.`)
  }
}
