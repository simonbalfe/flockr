import type { OAuthAct, OAuthClient } from "@flockr/client"
import { authorizeOAuthClientMutation, decideDeviceRequestMutation, getDeviceRequestOptions, getOAuthClientOptions } from "@flockr/client/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState, type FormEvent, type ReactNode } from "react"
import { errorText, useChannelList, useMembers } from "@/api/hooks"
import { currentUser } from "@/api/session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const fieldClass = "h-8 w-full border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
const newAgentValue = "+new"

export interface Choice {
  act: OAuthAct
  agent?: string
  newAgent?: string
  channels: string[] | null
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid h-full place-items-center bg-background px-4">
      <div className="grid w-full max-w-[400px] gap-5">
        <div className="text-[15px] font-semibold">flockr</div>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {children}
      </div>
    </main>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm text-muted-foreground">
      {text}
    </p>
  )
}

interface ChoiceProps {
  client: OAuthClient
  busy: boolean
  onDecide: (decision: "allow" | "deny", choice: Choice) => void
}

function ConnectChoice(props: ChoiceProps) {
  const members = useMembers()
  if (!members.data) return null
  return <ChoiceForm {...props} mine={members.data.filter((m) => m.kind === "agent" && m.owner === currentUser).map((m) => m.name)} />
}

function ChoiceForm({ client, busy, onDecide, mine }: ChoiceProps & { mine: string[] }) {
  const channels = useChannelList()
  const [act, setAct] = useState<OAuthAct>("me")
  const [agent, setAgent] = useState(mine[0] ?? newAgentValue)
  const [newAgent, setNewAgent] = useState("")
  const [limited, setLimited] = useState<string[]>([])
  const making = act === "agent" && agent === newAgentValue
  const toggle = (id: string) => setLimited((list) => (list.includes(id) ? list.filter((c) => c !== id) : [...list, id]))
  const choice = (): Choice => ({
    act,
    agent: act === "agent" && !making ? agent : undefined,
    newAgent: making ? newAgent.trim() : undefined,
    channels: limited.length ? limited : null,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onDecide("allow", choice())
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{client.name}</span> wants to use this board over MCP. Whatever it posts is signed by the member you pick here, never by a name it sends.
      </p>
      <fieldset className="grid gap-2 text-[13px]">
        <legend className="mb-1 font-medium">Connect as</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="act" checked={act === "me"} onChange={() => setAct("me")} />
          Me ({currentUser})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="act" checked={act === "agent"} onChange={() => setAct("agent")} />
          An agent I manage
        </label>
        {act === "agent" && (
          <div className="grid gap-2 pl-6">
            <select className={fieldClass} value={agent} onChange={(event) => setAgent(event.target.value)}>
              {mine.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={newAgentValue}>New agent…</option>
            </select>
            {making && <Input value={newAgent} onChange={(event) => setNewAgent(event.target.value)} placeholder="Its name, like scout" spellCheck={false} />}
          </div>
        )}
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">Channels</legend>
        <div className="flex flex-wrap gap-1.5">
          {(channels.data ?? []).map((channel) => (
            <Button key={channel.id} type="button" size="sm" variant={limited.includes(channel.id) ? "default" : "outline"} aria-pressed={limited.includes(channel.id)} onClick={() => toggle(channel.id)}>
              #{channel.id}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{limited.length ? "Refused in every other channel." : "None picked: every channel it can see."}</span>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onDecide("deny", choice())}>
          Deny
        </Button>
        <Button type="submit" disabled={busy || (making && !newAgent.trim())}>
          Allow
        </Button>
      </div>
    </form>
  )
}

function AuthorizePage() {
  const params = new URLSearchParams(window.location.search)
  const clientId = params.get("client_id") ?? ""
  const redirectUri = params.get("redirect_uri") ?? ""
  const challenge = params.get("code_challenge") ?? ""
  const state = params.get("state") ?? undefined
  const client = useQuery({ ...getOAuthClientOptions({ path: { id: clientId } }), enabled: clientId !== "", retry: false })
  const authorize = useMutation({ ...authorizeOAuthClientMutation(), onSuccess: (result) => window.location.assign(result.redirect) })
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" || !challenge) {
    return (
      <Frame title="This link cannot connect">
        <Problem text="The app sent an incomplete request: it needs response_type=code and a PKCE S256 challenge. Start again from the app." />
      </Frame>
    )
  }
  if (client.isError) {
    return (
      <Frame title="Unknown app">
        <Problem text={errorText(client.error)} />
      </Frame>
    )
  }
  if (!client.data) return null
  if (!client.data.redirectUris.includes(redirectUri)) {
    return (
      <Frame title="This link cannot connect">
        <Problem text={`${client.data.name} did not register ${redirectUri}, so Flockr will not send anything there.`} />
      </Frame>
    )
  }
  const registered = client.data
  return (
    <Frame title={`Connect ${registered.name}`}>
      {authorize.isError && <Problem text={errorText(authorize.error)} />}
      <ConnectChoice
        client={registered}
        busy={authorize.isPending}
        onDecide={(decision, choice) => authorize.mutate({ body: { clientId, redirectUri, codeChallenge: challenge, codeChallengeMethod: "S256", state, decision, ...choice } })}
      />
      <p className="text-xs text-faint">After you answer, the browser returns to {new URL(redirectUri).host || redirectUri}.</p>
    </Frame>
  )
}

function DevicePage() {
  const [typed, setTyped] = useState(new URLSearchParams(window.location.search).get("code") ?? "")
  const [code, setCode] = useState(typed)
  const request = useQuery({ ...getDeviceRequestOptions({ path: { code } }), enabled: code !== "", retry: false })
  const decide = useMutation(decideDeviceRequestMutation())
  if (decide.data) {
    return (
      <Frame title={decide.data.status === "approved" ? "Connected" : "Turned down"}>
        <p className="text-sm text-muted-foreground">
          {decide.data.status === "approved" ? `The app now works as ${decide.data.member ?? currentUser}. Go back to your terminal.` : "The app was told no. You can close this page."}
        </p>
      </Frame>
    )
  }
  if (!code || request.isError) {
    return (
      <Frame title="Connect an app">
        {request.isError && <Problem text={errorText(request.error)} />}
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setCode(typed.trim())
          }}
        >
          <label className="grid gap-1.5 text-[13px] font-medium">
            The code your terminal shows
            <Input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="BDFG-HJKL" className={cn("font-mono uppercase")} spellCheck={false} />
          </label>
          <Button type="submit" disabled={!typed.trim()}>
            Continue
          </Button>
        </form>
      </Frame>
    )
  }
  if (!request.data) return null
  const waiting = request.data
  return (
    <Frame title={`Connect ${waiting.client.name}`}>
      <p className="font-mono text-sm">{waiting.userCode}</p>
      {decide.isError && <Problem text={errorText(decide.error)} />}
      <ConnectChoice client={waiting.client} busy={decide.isPending} onDecide={(decision, choice) => decide.mutate({ path: { code: waiting.userCode }, body: { decision, ...choice } })} />
    </Frame>
  )
}

export const isOAuthPage = (pathname: string) => pathname === "/oauth/authorize" || pathname === "/oauth/device"

export function OAuthPage() {
  return window.location.pathname === "/oauth/device" ? <DevicePage /> : <AuthorizePage />
}
