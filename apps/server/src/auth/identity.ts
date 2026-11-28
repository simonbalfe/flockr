import { authBasePath, authorizationHeader, channelsHeader, channelsParam, defaultMember, fenceOf, memberHeader, narrowChannels, publicApiPaths, type AuthMode, type IdentitySource } from "@flockr/contracts"
import { findLiveKey } from "../board/keys"
import { findMember } from "../board/read"
import { viewerOf, type Viewer } from "../board/visibility"
import type { Database } from "../db/client"
import { isAgentToken, verifyAgentToken } from "./agent-token"
import { createBetterAuth, signsInAs, type BetterAuth } from "./better-auth"
import type { AuthSettings } from "./settings"

export interface Identity {
  member: string
  via: IdentitySource
  channels: string[] | null
  key: string | null
}

export interface Authenticator {
  mode: AuthMode
  identify: (headers: Headers) => Promise<Identity | null>
  betterAuth: () => BetterAuth
}

const bearer = /^Bearer\s+(\S+)$/i

export const isPublicApiPath = (pathname: string): boolean =>
  pathname === authBasePath || pathname.startsWith(`${authBasePath}/`) || publicApiPaths.some((path) => path === pathname)

export const headerIdentity = (headers: Headers): Identity => ({ member: headers.get(memberHeader)?.trim() || defaultMember, via: "header", channels: null, key: null })

async function actingAs(db: Database, identity: Identity, requested: string | undefined): Promise<Identity> {
  if (!requested || requested === identity.member) return identity
  const agent = await findMember(db, requested)
  return agent?.kind === "agent" && agent.owner === identity.member ? { ...identity, member: agent.name } : identity
}

export const signInNeeded = "Sign in, or send a key as Authorization: Bearer <key> (flockr keys create)"

export const liveAsParam = "as"

export async function liveViewer(auth: Authenticator, request: { headers: Headers; url: URL }): Promise<Viewer | Response> {
  const fence = fenceOf(request.headers.get(channelsHeader) ?? request.url.searchParams.get(channelsParam))
  if (auth.mode === "off") {
    const named = request.url.searchParams.get(liveAsParam)?.trim()
    return viewerOf(named || headerIdentity(request.headers).member, fence)
  }
  const identity = await auth.identify(request.headers)
  if (!identity) return Response.json({ error: signInNeeded, kind: "unauthenticated" }, { status: 401 })
  const viewer = viewerOf(identity.member, narrowChannels(identity.channels, fence))
  return identity.key === null ? viewer : { ...viewer, key: identity.key }
}

export function createAuthenticator(db: Database, settings: AuthSettings): Authenticator {
  let auth: BetterAuth | undefined
  const betterAuth = () => (auth ??= createBetterAuth(db, settings))

  const verified = async (headers: Headers): Promise<Identity | null> => {
    const key = bearer.exec(headers.get(authorizationHeader)?.trim() ?? "")?.[1]
    if (key && isAgentToken(key)) {
      const claims = await verifyAgentToken(settings.secret, key, new Date())
      const agent = claims ? await findMember(db, claims.agent) : undefined
      return agent?.kind === "agent" ? { member: agent.name, via: "key", channels: null, key: null } : null
    }
    if (key) {
      const found = await findLiveKey(db, key)
      return found ? { member: found.member, via: "key", channels: found.channels, key: found.id } : null
    }
    const session = await betterAuth().api.getSession({ headers })
    const member = session ? await signsInAs(db, settings, session.user.email) : undefined
    return member ? { member, via: "session", channels: null, key: null } : null
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
