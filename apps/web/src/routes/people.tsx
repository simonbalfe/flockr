import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { errorText, useMembers } from "@/api/hooks"
import { useCreateInvite, useInvites, useRevokeInvite } from "@/api/invites"
import { currentUser } from "@/api/session"
import { useOrgs, useUpdateOrg } from "@/api/sharing"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

const fieldClass = "h-8 w-full border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

type Inviter = { kind: "host" } | { kind: "owner"; org: string } | { kind: "none" }

function useInviter(): Inviter {
  const members = useMembers()
  const orgs = useOrgs()
  const me = members.data?.find((m) => m.name === currentUser)
  const mine = orgs.data?.find((o) => o.id === me?.org)
  if (!me || me.kind !== "person" || !mine) return { kind: "none" }
  if (mine.host) return { kind: "host" }
  return mine.selfInvites && mine.owner === me.name ? { kind: "owner", org: mine.id } : { kind: "none" }
}

function InviteDialog({ inviter }: { inviter: Exclude<Inviter, { kind: "none" }> }) {
  const create = useCreateInvite()
  const orgs = useOrgs()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [org, setOrg] = useState("")
  const options = (orgs.data ?? []).filter((o) => inviter.kind === "host" || o.id === inviter.org)
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

function OrgSettings() {
  const orgs = useOrgs()
  const members = useMembers()
  const update = useUpdateOrg()
  const clients = (orgs.data ?? []).filter((o) => !o.host)
  if (!clients.length) return <div className="text-sm text-faint">No client orgs yet.</div>
  return (
    <div className="grid gap-2">
      {clients.map((org) => {
        const people = (members.data ?? []).filter((m) => m.kind === "person" && m.org === org.id)
        return (
          <div key={org.id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            <select
              className={fieldClass + " w-40"}
              value={org.owner ?? ""}
              aria-label={`Owner of ${org.name}`}
              onChange={(e) => update.mutate({ id: org.id, owner: e.target.value || null }, { onError: (error) => toast.error(errorText(error)) })}
            >
              <option value="">No owner</option>
              {people.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Switch
                checked={org.selfInvites}
                disabled={update.isPending || org.owner === null}
                onCheckedChange={(checked) =>
                  update.mutate(
                    { id: org.id, selfInvites: checked },
                    { onSuccess: () => toast(checked ? `${org.owner ?? "The owner"} can invite people into ${org.name} now.` : `Self-invites off; ${org.name}'s open invites are revoked.`), onError: (error) => toast.error(errorText(error)) },
                  )
                }
              />
              Owner invites
            </label>
          </div>
        )
      })}
      <p className="text-xs text-faint">With Owner invites on, the owner invites people into that org only, by email. Off by default; turning it off revokes their open invites.</p>
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
  const inviter = useInviter()
  const mayManage = inviter.kind !== "none"
  return (
    <>
      <PageHeader title="People">{inviter.kind !== "none" && <InviteDialog inviter={inviter} />}</PageHeader>
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
          {inviter.kind === "host" && (
            <section className="grid gap-2">
              <h2 className="text-[13px] font-medium text-muted-foreground">Client orgs</h2>
              <OrgSettings />
            </section>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
