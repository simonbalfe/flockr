import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useHandOffTask, useMembers } from "@/api/hooks"
import type { Task } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

const fieldClass = "h-8 w-full rounded-lg border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function HandOffDialog({ task }: { task: Task }) {
  const members = useMembers()
  const handOff = useHandOffTask()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")
  const options = (members.data ?? []).filter((m) => m.name !== task.holder && (m.kind === "agent" || m.kind === "person"))
  const target = to || options[0]?.name || ""

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!target) return
    handOff.mutate(
      { id: task.id, to: target, note: note.trim() || undefined, epoch: task.claimEpoch },
      {
        onSuccess: () => {
          toast(`Handed #${task.id} to ${target}`)
          setOpen(false)
          setNote("")
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Hand off</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Hand #{task.id} to someone</DialogTitle>
            <DialogDescription>They hold it from now on, with its branch {task.branch} and working areas. The note goes in the thread.</DialogDescription>
          </DialogHeader>
          <select className={fieldClass} value={target} onChange={(e) => setTo(e.target.value)} aria-label="Hand to">
            {options.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is done and what is left" aria-label="Note" />
          <DialogFooter>
            <Button type="submit" disabled={handOff.isPending || !target}>
              Hand off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
