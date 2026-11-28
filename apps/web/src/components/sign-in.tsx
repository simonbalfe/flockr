import { signInWording } from "@flockr/client"
import { useState, type FormEvent } from "react"
import { useRequestLink } from "@/api/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const linkErrors: Record<string, string> = {
  INVALID_TOKEN: "That link was used already or has expired. Send a new one.",
  EXPIRED_TOKEN: "That link has expired. Send a new one.",
}

function linkError(): string | null {
  const code = new URLSearchParams(window.location.search).get("error")
  return code ? (linkErrors[code] ?? "That link did not work. Send a new one.") : null
}

function returnPath(): string {
  const params = new URLSearchParams(window.location.search)
  params.delete("error")
  const query = params.toString()
  return `${window.location.pathname}${query ? `?${query}` : ""}`
}

export function SignIn() {
  const request = useRequestLink()
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [problem] = useState(linkError)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address) return
    request.mutate({ body: { email: address, callbackURL: returnPath() } }, { onSuccess: () => setSentTo(address) })
  }

  return (
    <main className="grid h-full place-items-center bg-background px-4">
      <div className="grid w-full max-w-[360px] gap-6">
        <div className="text-[15px] font-semibold">flockr</div>
        {sentTo ? (
          <div className="grid gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Check your email</h1>
            <p className="text-sm text-muted-foreground">If {sentTo} may sign in here, a link is on its way. It works once, for 15 minutes.</p>
            <div>
              <Button variant="ghost" size="sm" className="-ml-2.5" onClick={() => setSentTo(null)}>
                Use another address
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Sign in</h1>
            {problem && (
              <p role="alert" className="text-sm text-muted-foreground">
                {problem}
              </p>
            )}
            <label className="grid gap-1.5 text-[13px] font-medium">
              Email
              <Input type="email" autoComplete="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <Button type="submit" disabled={request.isPending || !email.trim()}>
              {signInWording.button}
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
