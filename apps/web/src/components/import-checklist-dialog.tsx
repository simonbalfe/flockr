import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useImportChecklist } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function ImportChecklistDialog({ channel }: { channel: string }) {
  const importChecklist = useImportChecklist()
  const [open, setOpen] = useState(false)
  const [markdown, setMarkdown] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!markdown.trim()) return
    importChecklist.mutate(
      { channel, markdown },
      {
        onSuccess: (result) => {
          toast(`Made ${plural(result.created.length, "task")}, skipped ${result.skipped.length}`)
          setOpen(false)
          setMarkdown("")
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="max-sm:hidden">
          Import checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Import checklist</DialogTitle>
            <DialogDescription>
              Paste a SPEC_MASTER_CHECKLIST.md. Each row not yet Done becomes a task in #{channel}, waiting for the row before it in its phase. Rows that already have a task are skipped.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="max-h-[50vh] min-h-48 font-mono text-[12.5px] md:text-[12.5px]"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="| 1a Skeleton | both | Delivers | Covers | Not started |"
            required
            autoFocus
          />
          <DialogFooter>
            <Button type="submit" disabled={importChecklist.isPending || !markdown.trim()}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
