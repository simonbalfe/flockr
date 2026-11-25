import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useUpdateChannel } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function ChannelRepoDialog({ channel, repo }: { channel: string; repo: string | null }) {
  const update = useUpdateChannel()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(repo ?? "")

  const save = (next: string | null) =>
    update.mutate(
      { channel, repo: next },
      {
        onSuccess: (saved) => {
          toast(saved.repo ? `Commits in #${channel} link to ${saved.repo}` : `#${channel} has no repo`)
          setOpen(false)
        },
      },
    )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save(value.trim().replace(/^https?:\/\//, "").replace(/(\.git)?\/*$/, "") || null)
  }

  const onOpenChange = (next: boolean) => {
    if (next) setValue(repo ?? "")
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-48 max-sm:hidden" title={repo ?? undefined}>
          <span className="truncate">{repo ? repo.replace(/^[^/]+\//, "") : "Set repo"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Repo for #{channel}</DialogTitle>
            <DialogDescription>Commits on this channel's tasks link to this repo, as https://&lt;repo&gt;/commit/&lt;sha&gt;.</DialogDescription>
          </DialogHeader>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="github.com/owner/name" aria-label="Repo" autoFocus />
          <DialogFooter>
            {repo && (
              <Button type="button" variant="ghost" onClick={() => save(null)} disabled={update.isPending}>
                Remove
              </Button>
            )}
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
