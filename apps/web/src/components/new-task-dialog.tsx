import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useChannels, useCreateTask, useMembers } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { usePanel } from "@/lib/panel"

const fieldClass = "h-8 w-full rounded-lg border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
const anyone = ""

export function NewTaskDialog({ channel, variant = "outline" }: { channel?: string; variant?: "outline" | "secondary" }) {
  const channels = useChannels()
  const members = useMembers()
  const create = useCreateTask()
  const { openTask } = usePanel()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [chosenChannel, setChosenChannel] = useState<string | null>(null)
  const [assignee, setAssignee] = useState(anyone)
  const channelList = channels.data ?? []
  const selected = chosenChannel ?? channel ?? channelList[0]?.id ?? ""

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || !selected) return
    create.mutate(
      { channel: selected, title: trimmed, assignee: assignee === anyone ? null : assignee },
      {
        onSuccess: (task) => {
          toast(`Made #${task.id}`)
          setOpen(false)
          setTitle("")
          setChosenChannel(null)
          setAssignee(anyone)
          openTask(task.id)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <label className="grid gap-1.5 text-[13px] font-medium">
            Title
            <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </label>
          <label className="grid gap-1.5 text-[13px] font-medium">
            Channel
            <select className={fieldClass} value={selected} onChange={(e) => setChosenChannel(e.target.value)}>
              {channelList.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] font-medium">
            Assignee
            <select className={fieldClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value={anyone}>Anyone</option>
              {(members.data ?? []).map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !title.trim() || !selected}>
              Make task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
