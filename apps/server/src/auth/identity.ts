import { authBasePath, authorizationHeader, defaultMember, memberHeader, publicApiPaths, type AuthMode, type IdentitySource } from "@flockr/contracts"
import { findLiveKey } from "../board/keys"
import { findMember } from "../board/read"
import type { Database } from "../db/client"
import { createBetterAuth, memberFor, type BetterAuth } from "./better-auth"
import type { AuthSettings } from "./settings"

export interface Identity {
  member: string
  via: IdentitySource
  channels: string[] | null
}

export interface Authenticator {
  mode: AuthMode
  identify: (headers: Headers) => Promise<Identity | null>
  betterAuth: () => BetterAuth
}

const bearer = /^Bearer\s+(\S+)$/i

export const isPublicApiPath = (pathname: string): boolean =>
  pathname === authBasePath || pathname.startsWith(`${authBasePath}/`) || publicApiPaths.some((path) => path === pathname)

export const headerIdentity = (headers: Headers): Identity => ({ member: headers.get(memberHeader)?.trim() || defaultMember, via: "header", channels: null })

async function actingAs(db: Database, identity: Identity, requested: string | undefined): Promise<Identity> {
  if (!requested || requested === identity.member) return identity
  const agent = await findMember(db, requested)
  return agent?.kind === "agent" && agent.owner === identity.member ? { ...identity, member: agent.name } : identity
}

export const signInNeeded = "Sign in, or send a key as Authorization: Bearer <key> (flockr keys create)"

export async function refuseLive(auth: Authenticator, headers: Headers): Promise<Response | null> {
  if (auth.mode === "off") return null
  const identity = await auth.identify(headers)
  if (!identity) return Response.json({ error: signInNeeded, kind: "unauthenticated" }, { status: 401 })
  if (identity.channels !== null) return Response.json({ error: "A key limited to channels cannot open the live feed", kind: "forbidden" }, { status: 403 })
  return null
}

export function createAuthenticator(db: Database, settings: AuthSettings): Authenticator {
  let auth: BetterAuth | undefined
  const betterAuth = () => (auth ??= createBetterAuth(db, settings))

  const verified = async (headers: Headers): Promise<Identity | null> => {
    const key = bearer.exec(headers.get(authorizationHeader)?.trim() ?? "")?.[1]
    if (key) {
      const found = await findLiveKey(db, key)
      return found ? { member: found.member, via: "key", channels: found.channels } : null
    }
    const session = await betterAuth().api.getSession({ headers })
    const member = session ? memberFor(settings, session.user.email) : undefined
    return member ? { member, via: "session", channels: null } : null
  }

  return {
    mode: settings.mode,
    betterAuth,
    identify: async (headers) => {
      if (settings.mode === "off") return headerIdentity(headers)
      const identity = await verified(headers)
      return identity ? actingAs(db, identity, headers.get(memberHeader)?.trim()) : null
    },
  }
}
