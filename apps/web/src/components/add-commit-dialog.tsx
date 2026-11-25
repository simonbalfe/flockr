import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useAddCommit } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function AddCommitDialog({ taskId }: { taskId: number }) {
  const add = useAddCommit()
  const [open, setOpen] = useState(false)
  const [sha, setSha] = useState("")
  const [message, setMessage] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!sha.trim()) return
    add.mutate(
      { id: taskId, sha: sha.trim(), message: message.trim() || undefined },
      {
        onSuccess: () => {
          toast(`Added ${sha.trim().slice(0, 7)} to #${taskId}`)
          setOpen(false)
          setSha("")
          setMessage("")
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Add commit</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a commit to #{taskId}</DialogTitle>
            <DialogDescription>A commit that did this task. Adding one the task already has changes nothing.</DialogDescription>
          </DialogHeader>
          <Input value={sha} onChange={(e) => setSha(e.target.value)} placeholder="Sha, such as a1b2c3d" aria-label="Sha" className="font-mono" required autoFocus />
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Subject line (optional)" aria-label="Subject line" />
          <DialogFooter>
            <Button type="submit" disabled={add.isPending || !sha.trim()}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
