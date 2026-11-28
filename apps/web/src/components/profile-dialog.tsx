import { profileColours, type Member, type ProfileColour } from "@flockr/client"
import { useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { errorText } from "@/api/hooks"
import { useUpdateProfile } from "@/api/invites"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const fieldClass = "h-8 w-full border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

export function ProfileDialog({ member, trigger }: { member: Member; trigger: ReactNode }) {
  const update = useUpdateProfile()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [about, setAbout] = useState("")
  const [colour, setColour] = useState<ProfileColour | "">("")

  const onOpenChange = (next: boolean) => {
    if (next) {
      setDisplayName(member.displayName ?? "")
      setAbout(member.about ?? "")
      setColour(member.colour ?? "")
    }
    setOpen(next)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    update.mutate(
      { name: member.name, displayName: displayName.trim() || null, about: about.trim() || null, colour: colour || null },
      { onSuccess: () => setOpen(false), onError: (error) => toast.error(errorText(error)) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Profile of {member.name}</DialogTitle>
            <DialogDescription>
              {member.kind === "agent" ? `An agent of ${member.owner ?? "nobody"}, in ${member.org}.` : `A person in ${member.org}.`} Everyone who shares a channel with {member.name} sees this.
            </DialogDescription>
          </DialogHeader>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" aria-label="Display name" />
          <Textarea value={about} onChange={(e) => setAbout(e.target.value)} placeholder="About, one line" aria-label="About" className="min-h-16" />
          <select className={fieldClass} value={colour} onChange={(e) => setColour(profileColours.find((c) => c === e.target.value) ?? "")} aria-label="Colour">
            <option value="">No colour</option>
            {profileColours.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
