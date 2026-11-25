import type { ReactNode } from "react"
import { isSignedOut, useWhoami } from "@/api/auth"
import { actAs } from "@/api/session"
import { SignIn } from "@/components/sign-in"

export function SessionGate({ children }: { children: ReactNode }) {
  const me = useWhoami()
  if (me.isPending) return null
  if (me.isError && isSignedOut(me.error)) return <SignIn />
  if (me.data) actAs(me.data.name)
  return children
}
