import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useMayManageKeys } from "@/api/auth"
import { errorText, useMembers } from "@/api/hooks"
import { useCreateInvite, useInvites, useRevokeInvite } from "@/api/invites"
import { useOrgs } from "@/api/sharing"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

const fieldClass = "h-8 w-full border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

function InviteDialog() {
  const create = useCreateInvite()
  const orgs = useOrgs()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [org, setOrg] = useState("")
  const options = orgs.data ?? []
  const target = org || options.find((o) => !o.host)?.id || options[0]?.id || ""

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate(
      { email: email.trim(), name: name.trim(), org: target },
      {
        onSuccess: (invite) => {
          toast(`Invited ${invite.email} as ${invite.name}`)
          setOpen(false)
          setEmail("")
          setName("")
        },
        onError: (error) => toast.error(errorText(error)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Invite person</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Invite a person</DialogTitle>
            <DialogDescription>They get an email, then sign in with that address. Their first sign-in makes them a member of the org.</DialogDescription>
          </DialogHeader>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ana@acme.example" aria-label="Email" autoFocus />
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="Member name, such as ana" aria-label="Member name" />
          <select className={fieldClass} value={target} onChange={(e) => setOrg(e.target.value)} aria-label="Org">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.host ? " (ours)" : ""}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !email.trim() || !name.trim() || !target}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteList() {
  const invites = useInvites(true)
  const revoke = useRevokeInvite()
  const list = invites.data ?? []
  if (invites.isSuccess && !list.length) return <div className="text-sm text-faint">No invites yet.</div>
  return (
    <div className="grid gap-1.5">
      {list.map((invite) => (
        <div key={invite.id} className="flex items-center gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {invite.email} <span className="text-muted-foreground">as {invite.name} in {invite.org}</span>
          </span>
          <span className="text-[13px] text-muted-foreground">{invite.state}</span>
          {invite.state === "open" && (
            <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id, { onError: (error) => toast.error(errorText(error)) })}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

function MemberList() {
  const members = useMembers()
  return (
    <div className="grid gap-1.5">
      {(members.data ?? [])
        .filter((m) => m.kind === "person")
        .map((m) => (
          <div key={m.name} className="flex items-center gap-3 text-sm">
            <span className="flex-1">
              {m.displayName ?? m.name}
              {m.displayName && <span className="ml-2 text-faint">{m.name}</span>}
            </span>
            <span className="text-[13px] text-muted-foreground">{m.org}</span>
          </div>
        ))}
    </div>
  )
}

export function PeopleView() {
  const mayManage = useMayManageKeys()
  return (
    <>
      <PageHeader title="People">{mayManage && <InviteDialog />}</PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid max-w-[720px] gap-6 px-4 pt-5 pb-6 nav:pl-6">
          <section className="grid gap-2">
            <h2 className="text-[13px] font-medium text-muted-foreground">People</h2>
            <MemberList />
          </section>
          {mayManage && (
            <section className="grid gap-2">
              <h2 className="text-[13px] font-medium text-muted-foreground">Invites</h2>
              <InviteList />
            </section>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
