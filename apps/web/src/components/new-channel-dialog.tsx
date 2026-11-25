import { useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { errorText, useCreateChannel } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// Channel names are lowercase words joined by dashes, as the API requires.
const slug = (text: string) => text.trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")

export function NewChannelDialog() {
  const create = useCreateChannel()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const id = slug(name)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!id) return
    create.mutate(
      { id, topic: topic.trim() },
      {
        onSuccess: (channel) => {
          setOpen(false)
          setName("")
          setTopic("")
          void navigate({ to: "/c/$channel", params: { channel: channel.id }, search: (prev) => prev })
        },
        onError: (error) => toast(errorText(error)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="New channel" className="text-faint hover:text-foreground">
              <Plus />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>New channel</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New channel</DialogTitle>
            <DialogDescription>Everyone on the board can see it. Same as flockr channels create.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. website" aria-label="Channel name" autoFocus />
            {name && id !== name.trim() && <span className="text-xs text-faint">Will be #{id || "…"}</span>}
          </div>
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)" aria-label="Topic" />
          <DialogFooter>
            <Button type="submit" disabled={!id || create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
