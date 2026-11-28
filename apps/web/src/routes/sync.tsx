import type { Bridge } from "@flockr/client"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useBridges, useLinkBridgeChannel, useLinkBridgePerson, useUnlinkBridgeChannel, useUnlinkBridgePerson } from "@/api/bridges"
import { errorText, useChannelList } from "@/api/hooks"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

const fieldClass = "h-8 border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

const onError = (error: unknown) => void toast(errorText(error))

function YourUser({ bridge }: { bridge: Bridge }) {
  const link = useLinkBridgePerson()
  const forget = useUnlinkBridgePerson()
  const [external, setExternal] = useState("")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    link.mutate({ bridge: bridge.name, external: external.trim() }, { onError, onSuccess: () => setExternal("") })
  }
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium">Your {bridge.label} user</h3>
      {bridge.me ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono">{bridge.me}</span>
          <Button variant="ghost" size="sm" disabled={forget.isPending} onClick={() => forget.mutate(bridge.name, { onError })}>
            Forget
          </Button>
        </div>
      ) : (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
          <input className={fieldClass} placeholder="U07ABC123" aria-label={`Your ${bridge.label} user id`} value={external} onChange={(e) => setExternal(e.target.value)} />
          <Button size="sm" type="submit" disabled={!external.trim() || link.isPending}>
            Link
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">Your messages in {bridge.label} post as you, and your presses on question and review buttons count.</p>
    </section>
  )
}

function Channels({ bridge }: { bridge: Bridge }) {
  const channels = useChannelList()
  const link = useLinkBridgeChannel()
  const unlink = useUnlinkBridgeChannel()
  const linked = new Set(bridge.channels.map((c) => c.channel))
  const choices = (channels.data ?? []).filter((c) => c.visibility === "org" && !linked.has(c.id))
  const [channel, setChannel] = useState("")
  const [external, setExternal] = useState("")
  const picked = channel || choices[0]?.id || ""
  const submit = (event: FormEvent) => {
    event.preventDefault()
    link.mutate({ bridge: bridge.name, channel: picked, external: external.trim() }, { onError, onSuccess: () => setExternal("") })
  }
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium">Channels</h3>
      {bridge.channels.length > 0 && (
        <ul className="grid gap-1">
          {bridge.channels.map((c) => (
            <li key={c.channel} className="flex items-center gap-3 text-sm">
              <span className="w-40 truncate">#{c.channel}</span>
              <span className="font-mono text-muted-foreground">{c.external}</span>
              <span className="flex-1 text-xs text-muted-foreground">by {c.linkedBy}</span>
              <Button variant="ghost" size="sm" disabled={unlink.isPending} onClick={() => unlink.mutate({ bridge: bridge.name, channel: c.channel }, { onError })}>
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <select className={fieldClass} aria-label="Channel" value={picked} onChange={(e) => setChannel(e.target.value)}>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.id}
            </option>
          ))}
        </select>
        <input className={fieldClass} placeholder="C07ABC123" aria-label={`${bridge.label} channel id`} value={external} onChange={(e) => setExternal(e.target.value)} />
        <Button size="sm" type="submit" disabled={!picked || !external.trim() || link.isPending}>
          Link channel
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Messages, replies and cards sync both ways. Private and shared channels stay off {bridge.label}.</p>
    </section>
  )
}

function BridgeSection({ bridge }: { bridge: Bridge }) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-[15px] font-semibold">{bridge.label}</h2>
        <p className="text-xs text-muted-foreground">{bridge.enabled ? "On: the server holds the tokens; no agent does." : `Off: the server has no ${bridge.label} secrets yet, so nothing syncs.`}</p>
      </div>
      <Channels bridge={bridge} />
      <YourUser bridge={bridge} />
    </div>
  )
}

export function SyncView() {
  const bridges = useBridges()
  return (
    <>
      <PageHeader title="Chat sync" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid max-w-[720px] gap-10 px-4 pt-3 pb-6 nav:pl-6">
          {bridges.data ? (
            bridges.data.bridges.map((bridge) => <BridgeSection key={bridge.name} bridge={bridge} />)
          ) : bridges.isError ? (
            <p className="py-2 text-sm text-muted-foreground">{errorText(bridges.error)}</p>
          ) : (
            <div className="py-2 text-sm text-faint">Loading</div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
