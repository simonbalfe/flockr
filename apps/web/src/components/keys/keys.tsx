import type { MemberKey } from "@flockr/client"
import { KeyRound } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useCreateKey, useKeys, useMayManageKeys, useRevokeKey } from "@/api/auth"
import { useChannelList, useMembers } from "@/api/hooks"
import { CopyCommand } from "@/components/agents/copy-command"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useNow } from "@/lib/now"
import { relative } from "@/lib/routine"
import { cn } from "@/lib/utils"

const fieldClass = "h-8 w-full rounded-lg border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function RevokeButton({ id }: { id: string }) {
  const revoke = useRevokeKey()
  const [confirming, setConfirming] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(confirming && "text-destructive")}
      disabled={revoke.isPending}
      onBlur={() => setConfirming(false)}
      onClick={() => (confirming ? revoke.mutate({ path: { id } }, { onSuccess: () => void toast("Key revoked. Requests with it are refused now.") }) : setConfirming(true))}
    >
      {confirming ? "Revoke? Click again" : "Revoke"}
    </Button>
  )
}

function KeyRow({ entry, showMember, mayManage }: { entry: MemberKey; showMember: boolean; mayManage: boolean }) {
  const now = useNow()
  const limit = entry.channels ? entry.channels.map((c) => `#${c}`).join(", ") : "All channels"
  const used = entry.revokedAt ? `Revoked ${relative(entry.revokedAt, now)}` : entry.lastUsedAt ? `Used ${relative(entry.lastUsedAt, now)}` : "Never used"
  return (
    <li className="flex min-w-0 items-center gap-3">
      <div className={cn("min-w-0 flex-1", entry.revokedAt && "text-faint")}>
        <div className="truncate text-sm">
          <span className="font-mono text-[13px]">{entry.shown}…</span>
          {showMember && <span className="font-medium"> {entry.owner ? `${entry.member} via ${entry.owner}` : entry.member}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {limit} · {used} · made by {entry.createdBy}
        </div>
      </div>
      {mayManage && !entry.revokedAt && <RevokeButton id={entry.id} />}
    </li>
  )
}

export function KeyList({ member }: { member?: string }) {
  const keys = useKeys()
  const mayManage = useMayManageKeys()
  const list = (keys.data ?? []).filter((k) => member === undefined || k.member === member)
  if (!list.length) return <div className="px-1 text-[13px] text-faint">{member ? `No keys for ${member}.` : "No keys yet."}</div>
  return (
    <ul className="grid gap-3">
      {list.map((entry) => (
        <KeyRow key={entry.id} entry={entry} showMember={member === undefined} mayManage={mayManage} />
      ))}
    </ul>
  )
}

export function NewKeyDialog({ member, size = "sm" }: { member?: string; size?: "sm" | "default" }) {
  const members = useMembers()
  const channels = useChannelList()
  const create = useCreateKey()
  const mayManage = useMayManageKeys()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState("")
  const [limited, setLimited] = useState<string[]>([])
  const [secret, setSecret] = useState<string | null>(null)
  const owners = (members.data ?? []).filter((m) => m.kind === "person" || m.kind === "agent")
  const target = member ?? (chosen || owners[0]?.name || "")

  const reset = () => {
    setChosen("")
    setLimited([])
    setSecret(null)
  }
  const toggle = (id: string) => setLimited((list) => (list.includes(id) ? list.filter((c) => c !== id) : [...list, id]))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!target) return
    create.mutate({ body: { member: target, channels: limited.length ? limited : null } }, { onSuccess: (made) => setSecret(made.secret) })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size={size} disabled={!mayManage}>
          <KeyRound />
          New key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{secret ? `Key for ${target}` : member ? `New key for ${member}` : "New key"}</DialogTitle>
        </DialogHeader>
        {secret ? (
          <div className="grid gap-3">
            <CopyCommand command={secret} />
            <p className="text-[13px] text-muted-foreground">Copy it now: it is not shown again. Use it as FLOCKR_KEY, or as key in ~/.flockr/runner.json.</p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            {member === undefined && (
              <label className="grid gap-1.5 text-[13px] font-medium">
                Acts as
                <select className={fieldClass} value={target} onChange={(event) => setChosen(event.target.value)}>
                  {owners.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.owner ? `${m.name} via ${m.owner}` : m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-[13px] font-medium">Channels</legend>
              <div className="flex flex-wrap gap-1.5">
                {(channels.data ?? []).map((channel) => (
                  <Button key={channel.id} type="button" size="sm" variant={limited.includes(channel.id) ? "default" : "outline"} aria-pressed={limited.includes(channel.id)} onClick={() => toggle(channel.id)}>
                    #{channel.id}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{limited.length ? "Refused in every other channel and on the live feed." : "None picked: every channel."}</span>
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending || !target}>
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
