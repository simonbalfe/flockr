import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { errorText, useHandOffTask, useMembers } from "@/api/hooks"
import type { Task } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

const fieldClass = "h-8 w-full  border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

export function HandOffDialog({ task }: { task: Task }) {
  const members = useMembers()
  const handOff = useHandOffTask()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")
  const [commit, setCommit] = useState("")
  const [tests, setTests] = useState("")
  const [files, setFiles] = useState("")
  const [steps, setSteps] = useState("")
  const options = (members.data ?? []).filter((m) => m.name !== task.holder && (m.kind === "agent" || m.kind === "person"))
  const target = to || options[0]?.name || ""

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!target) return
    handOff.mutate(
      {
        id: task.id,
        to: target,
        note: note.trim() || undefined,
        epoch: task.claimEpoch,
        lastCommit: commit.trim() || undefined,
        testState: tests.trim() || undefined,
        files: lines(files.replaceAll(",", "\n")),
        nextSteps: lines(steps),
      },
      {
        onSuccess: () => {
          toast(`Handed #${task.id} to ${target}`)
          setOpen(false)
          setNote("")
          setCommit("")
          setTests("")
          setFiles("")
          setSteps("")
        },
        onError: (error) => toast.error(errorText(error)),
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
            <DialogDescription>They hold it from now on, with its branch {task.branch} and working areas. The thread gets one hand-off record they start from.</DialogDescription>
          </DialogHeader>
          <select className={fieldClass} value={target} onChange={(e) => setTo(e.target.value)} aria-label="Hand to">
            {options.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is done and what is left" aria-label="Note" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="Last commit" aria-label="Last commit" className="font-mono" />
            <Input value={tests} onChange={(e) => setTests(e.target.value)} placeholder="Where the tests stand" aria-label="Tests" />
          </div>
          <Textarea value={files} onChange={(e) => setFiles(e.target.value)} placeholder="Files touched, one per line" aria-label="Files" className="min-h-16 font-mono text-[13px]" />
          <Textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="Next steps, one per line" aria-label="Next steps" className="min-h-16" />
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
