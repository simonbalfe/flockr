import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { errorText, useDeclareArea } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function DeclareAreaDialog({ channel }: { channel: string }) {
  const declare = useDeclareArea()
  const [open, setOpen] = useState(false)
  const [paths, setPaths] = useState("")
  const [note, setNote] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const list = paths.split(/[\s,]+/).filter(Boolean)
    if (!list.length) return
    declare.mutate(
      { channel, paths: list, note: note.trim() || undefined },
      {
        onSuccess: (result) => {
          toast(result.overlaps.length ? `Declared, but it overlaps ${result.overlaps.map((o) => o.area.owner).join(", ")}` : "Declared")
          setOpen(false)
          setPaths("")
          setNote("")
        },
        onError: (error) => toast(errorText(error)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Declare area
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Where are you working in #{channel}?</DialogTitle>
            <DialogDescription>Files, folders or globs in the repo, separated by spaces. Agents see this and pick other work. It runs out after an hour.</DialogDescription>
          </DialogHeader>
          <Input value={paths} onChange={(e) => setPaths(e.target.value)} placeholder="apps/web packages/contracts/**" aria-label="Paths" className="font-mono" required autoFocus />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" aria-label="Note" />
          <DialogFooter>
            <Button type="submit" disabled={declare.isPending || !paths.trim()}>
              Declare
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
