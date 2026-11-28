import { Clock } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { errorText } from "@/api/hooks"
import { useSchedulePost } from "@/api/scheduled"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const inAnHour = () => {
  const next = new Date(Date.now() + 3_600_000)
  next.setSeconds(0, 0)
  const local = new Date(next.getTime() - next.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function ScheduleDialog({ channel }: { channel: string }) {
  const schedule = useSchedulePost()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [when, setWhen] = useState(inAnHour)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    schedule.mutate(
      { channel, text: text.trim(), at: new Date(when).toISOString() },
      {
        onSuccess: (s) => {
          toast(`Scheduled for ${new Date(s.at).toLocaleString()}`)
          setOpen(false)
          setText("")
        },
        onError: (error) => toast.error(errorText(error)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Schedule a post">
          <Clock className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Schedule a post in #{channel}</DialogTitle>
            <DialogDescription>It posts as you at that time. Cancel it from Drafts & sent before then.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" />
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When" />
          <DialogFooter>
            <Button type="submit" disabled={schedule.isPending || !text.trim() || !when}>
              Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
