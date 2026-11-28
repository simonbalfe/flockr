import {
  agentNamePattern,
  deviceGrantType,
  oauthLimits,
  oauthPaths,
  oauthScope,
  type AuthorizeBody,
  type AuthorizeResult,
  type DeviceDecision,
  type DeviceDecisionBody,
  type DeviceRequest,
  type IdentitySource,
  type OAuthChoice,
  type OAuthClient,
} from "@flockr/contracts"
import { and, eq, gt } from "drizzle-orm"
import { z } from "zod"
import { forbidden, invalid, notFound, wrongState } from "../board/errors"
import { createKey, hashKey, revokeClientKey } from "../board/keys"
import { createMember, requireActor } from "../board/members"
import { findMember } from "../board/read"
import { canSee, viewerOf } from "../board/visibility"
import type { Database } from "../db/client"
import { oauthClients, oauthGrants, type MemberRow, type OAuthClientRow, type OAuthGrantRow } from "../db/schema"

export interface OAuthSettings {
  enabled: boolean
  baseURL: string
}

export interface Consenter {
  member: string
  via: IdentitySource
}

const protocolPaths = new Set<string>([oauthPaths.register, oauthPaths.token, oauthPaths.device, oauthPaths.revoke])

export const isOAuthProtocolPath = (pathname: string): boolean => protocolPaths.has(pathname) || pathname.startsWith("/.well-known/")

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)))
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
}

function userCode(): string {
  const alphabet = oauthLimits.userCodeAlphabet
  const picks = [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => alphabet[byte % alphabet.length] ?? "B")
  return `${picks.slice(0, 4).join("")}-${picks.slice(4).join("")}`
}

export const normalUserCode = (raw: string): string => {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, "")
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : raw.toUpperCase()
}

const blockedSchemes = new Set(["javascript", "data", "file", "vbscript", "blob", "about"])
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])

export function redirectAllowed(uri: string): boolean {
  if (uri.length > oauthLimits.redirectUriMax) return false
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.hash) return false
  const scheme = url.protocol.replace(/:$/, "")
  if (scheme === "https") return true
  if (scheme === "http") return loopback.has(url.hostname)
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !blockedSchemes.has(scheme)
}

const clientView = (row: OAuthClientRow): OAuthClient => ({ id: row.id, name: row.name, redirectUris: row.redirectUris })

export function authorizationServerMetadata(baseURL: string) {
  return {
    issuer: baseURL,
    authorization_endpoint: `${baseURL}${oauthPaths.authorizePage}`,
    token_endpoint: `${baseURL}${oauthPaths.token}`,
    registration_endpoint: `${baseURL}${oauthPaths.register}`,
    device_authorization_endpoint: `${baseURL}${oauthPaths.device}`,
    revocation_endpoint: `${baseURL}${oauthPaths.revoke}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", deviceGrantType],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [oauthScope],
  }
}

export function protectedResourceMetadata(baseURL: string) {
  return { resource: `${baseURL}/mcp`, authorization_servers: [baseURL], bearer_methods_supported: ["header"], scopes_supported: [oauthScope], resource_name: "Flockr board" }
}

export const resourceMetadataUrl = (baseURL: string) => `${baseURL}${oauthPaths.protectedResource}/mcp`

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } })
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status)

async function fields(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? ""
  if (type.includes("application/json")) {
    const body: unknown = await request.json().catch(() => null)
    return z.record(z.string(), z.unknown()).catch({}).parse(body)
  }
  return Object.fromEntries(new URLSearchParams(await request.text()))
}

const RegisterBody = z.object({
  client_name: z.string().trim().min(1).max(oauthLimits.clientNameMax).default("MCP client"),
  redirect_uris: z.array(z.string()).max(oauthLimits.redirectUris).default([]),
  grant_types: z.array(z.string()).default(["authorization_code"]),
})

async function register(db: Database, request: Request): Promise<Response> {
  const parsed = RegisterBody.safeParse(await fields(request))
  if (!parsed.success) return oauthError("invalid_client_metadata", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  const body = parsed.data
  const bad = body.redirect_uris.find((uri) => !redirectAllowed(uri))
  if (bad !== undefined) return oauthError("invalid_redirect_uri", `${bad} is not allowed: use https, http on localhost, or an app's own scheme`)
  if (!body.redirect_uris.length && !body.grant_types.includes(deviceGrantType)) return oauthError("invalid_redirect_uri", "Send redirect_uris, or register for the device flow only")
  const [row] = await db
    .insert(oauthClients)
    .values({ id: `oc_${hex(crypto.getRandomValues(new Uint8Array(8)))}`, name: body.client_name, redirectUris: body.redirect_uris })
    .returning()
  if (!row) throw new Error("Client insert returned nothing")
  return json(
    {
      client_id: row.id,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_name: row.name,
      redirect_uris: row.redirectUris,
      grant_types: body.grant_types.filter((grant) => grant === "authorization_code" || grant === deviceGrantType),
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  )
}

async function findClientRow(db: Database, id: string): Promise<OAuthClientRow | undefined> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id))
  return row
}

async function mint(db: Database, grant: OAuthGrantRow, client: OAuthClientRow): Promise<Response> {
  if (!grant.member || !grant.approvedBy) return oauthError("invalid_grant", "This grant was never approved")
  try {
    const made = await createKey(db, grant.approvedBy, { member: grant.member, channels: grant.channels, client: { id: client.id, name: client.name } })
    return json({ access_token: made.secret, token_type: "Bearer", scope: oauthScope })
  } catch (error) {
    return oauthError("invalid_grant", error instanceof Error ? error.message : "The grant can no longer be used")
  }
}

async function spend(db: Database, grant: OAuthGrantRow): Promise<boolean> {
  const [used] = await db
    .update(oauthGrants)
    .set({ state: "used" })
    .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.state, "approved")))
    .returning({ id: oauthGrants.id })
  return used !== undefined
}

async function token(db: Database, request: Request, now: Date): Promise<Response> {
  const form = await fields(request)
  const text = (name: string) => (typeof form[name] === "string" ? form[name] : "")
  const client = await findClientRow(db, text("client_id"))
  if (!client) return oauthError("invalid_client", "Unknown client_id; register first", 401)
  const grantType = text("grant_type")
  if (grantType === "authorization_code") {
    const [grant] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.codeHash, await hashKey(text("code"))), eq(oauthGrants.kind, "code")))
    if (!grant || grant.state !== "approved" || grant.expiresAt <= now || grant.client !== client.id) return oauthError("invalid_grant", "The code is unknown, used, expired or for another client")
    if (grant.redirectUri !== text("redirect_uri")) return oauthError("invalid_grant", "redirect_uri does not match the one the code was issued for")
    if (!grant.codeChallenge || (await s256(text("code_verifier"))) !== grant.codeChallenge) return oauthError("invalid_grant", "code_verifier does not match the code_challenge")
    if (!(await spend(db, grant))) return oauthError("invalid_grant", "The code was used already")
    return mint(db, grant, client)
  }
  if (grantType === deviceGrantType) {
    const [grant] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.codeHash, await hashKey(text("device_code"))), eq(oauthGrants.kind, "device")))
    if (!grant || grant.client !== client.id) return oauthError("invalid_grant", "Unknown device_code for this client")
    if (grant.expiresAt <= now && grant.state !== "used") return oauthError("expired_token", "The code expired; start again")
    switch (grant.state) {
      case "pending":
        return oauthError("authorization_pending", "Waiting for a person to approve the code")
      case "denied":
        return oauthError("access_denied", "A person turned the connection down")
      case "used":
        return oauthError("invalid_grant", "The device code was used already")
      case "approved":
        if (!(await spend(db, grant))) return oauthError("invalid_grant", "The device code was used already")
        return mint(db, grant, client)
      default: {
        const unknown: never = grant.state
        throw new Error(`Unknown grant state ${String(unknown)}`)
      }
    }
  }
  return oauthError("unsupported_grant_type", "Use authorization_code with PKCE, or the device code grant")
}

async function device(db: Database, request: Request, settings: OAuthSettings, now: Date): Promise<Response> {
  const form = await fields(request)
  const client = await findClientRow(db, typeof form.client_id === "string" ? form.client_id : "")
  if (!client) return oauthError("invalid_client", "Unknown client_id; register first", 401)
  const deviceCode = randomToken()
  const code = userCode()
  await db.insert(oauthGrants).values({
    kind: "device",
    codeHash: await hashKey(deviceCode),
    userCode: code,
    client: client.id,
    state: "pending",
    expiresAt: new Date(now.getTime() + oauthLimits.deviceMinutes * 60_000),
  })
  const page = `${settings.baseURL}${oauthPaths.devicePage}`
  return json({ device_code: deviceCode, user_code: code, verification_uri: page, verification_uri_complete: `${page}?code=${code}`, expires_in: oauthLimits.deviceMinutes * 60, interval: oauthLimits.pollSeconds })
}

async function revoke(db: Database, request: Request): Promise<Response> {
  const form = await fields(request)
  if (typeof form.token === "string" && form.token) await revokeClientKey(db, form.token, typeof form.client_id === "string" ? form.client_id : null)
  return new Response(null, { status: 200 })
}

export async function oauthProtocol(db: Database, settings: OAuthSettings, request: Request, pathname: string, now = new Date()): Promise<Response> {
  if (!settings.enabled) return json({ error: "Sign-in is off on this board (FLOCKR_AUTH=off), so there is no OAuth", kind: "not_found" }, 404)
  if (request.method === "GET" && pathname === oauthPaths.authorizationServer) return json(authorizationServerMetadata(settings.baseURL))
  if (request.method === "GET" && (pathname === oauthPaths.protectedResource || pathname === `${oauthPaths.protectedResource}/mcp`)) return json(protectedResourceMetadata(settings.baseURL))
  if (request.method === "POST" && pathname === oauthPaths.register) return register(db, request)
  if (request.method === "POST" && pathname === oauthPaths.token) return token(db, request, now)
  if (request.method === "POST" && pathname === oauthPaths.device) return device(db, request, settings, now)
  if (request.method === "POST" && pathname === oauthPaths.revoke) return revoke(db, request)
  return json({ error: `No OAuth route for ${request.method} ${pathname}`, kind: "not_found" }, 404)
}

async function requireConsenter(db: Database, consenter: Consenter): Promise<MemberRow> {
  if (consenter.via === "key") throw forbidden("A key cannot approve an OAuth connection; a signed-in person does")
  const person = await requireActor(db, consenter.member)
  if (person.kind !== "person") throw forbidden(`${person.name} is an ${person.kind}; only a person approves an OAuth connection`)
  return person
}

async function grantMember(db: Database, person: MemberRow, choice: OAuthChoice, client: OAuthClientRow): Promise<string> {
  const member = await chosenMember(db, person, choice, client)
  for (const channel of choice.channels ?? []) if (!(await canSee(db, viewerOf(member), channel))) throw invalid(`${member} cannot see #${channel}`)
  return member
}

async function chosenMember(db: Database, person: MemberRow, choice: OAuthChoice, client: OAuthClientRow): Promise<string> {
  if (choice.act === "me") return person.name
  if (choice.agent) {
    const agent = await findMember(db, choice.agent)
    if (!agent || agent.kind !== "agent" || agent.owner !== person.name) throw forbidden(`${choice.agent} is not an agent you own; pick one of yours or make a new one`)
    return agent.name
  }
  if (choice.newAgent) {
    if (!agentNamePattern.test(choice.newAgent)) throw invalid("Name the new agent with lowercase letters, digits and dashes, starting with a letter")
    const made = await createMember(db, person.name, { name: choice.newAgent, kind: "agent", org: person.org, owner: person.name, runsIn: `${client.name} over MCP`, source: null })
    return made.name
  }
  throw invalid("With act agent, name an agent you own in agent, or a new one in newAgent")
}

export async function getOAuthClient(db: Database, consenter: Consenter, id: string): Promise<OAuthClient> {
  await requireConsenter(db, consenter)
  const row = await findClientRow(db, id)
  if (!row) throw notFound(`No OAuth client ${id}; the app has to register again`)
  return clientView(row)
}

export async function authorizeClient(db: Database, consenter: Consenter, body: AuthorizeBody, now = new Date()): Promise<AuthorizeResult> {
  const person = await requireConsenter(db, consenter)
  const client = await findClientRow(db, body.clientId)
  if (!client) throw notFound(`No OAuth client ${body.clientId}; the app has to register again`)
  if (!client.redirectUris.includes(body.redirectUri)) throw invalid(`${body.redirectUri} is not a redirect ${client.name} registered`)
  const back = new URL(body.redirectUri)
  if (body.state !== undefined) back.searchParams.set("state", body.state)
  if (body.decision === "deny") {
    back.searchParams.set("error", "access_denied")
    return { redirect: back.toString() }
  }
  const member = await grantMember(db, person, body, client)
  const code = randomToken()
  await db.insert(oauthGrants).values({
    kind: "code",
    codeHash: await hashKey(code),
    client: client.id,
    redirectUri: body.redirectUri,
    codeChallenge: body.codeChallenge,
    state: "approved",
    member,
    channels: body.channels,
    approvedBy: person.name,
    expiresAt: new Date(now.getTime() + oauthLimits.codeMinutes * 60_000),
  })
  back.searchParams.set("code", code)
  return { redirect: back.toString() }
}

async function pendingDevice(db: Database, code: string, now: Date): Promise<{ grant: OAuthGrantRow; client: OAuthClientRow }> {
  const [found] = await db
    .select({ grant: oauthGrants, client: oauthClients })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.client))
    .where(and(eq(oauthGrants.userCode, normalUserCode(code)), eq(oauthGrants.kind, "device"), eq(oauthGrants.state, "pending"), gt(oauthGrants.expiresAt, now)))
  if (!found) throw notFound("No waiting connection with that code; it may have expired or been used. Start again in the app")
  return found
}

export async function getDeviceRequest(db: Database, consenter: Consenter, code: string, now = new Date()): Promise<DeviceRequest> {
  await requireConsenter(db, consenter)
  const { grant, client } = await pendingDevice(db, code, now)
  return { userCode: grant.userCode ?? code, client: clientView(client), expiresAt: grant.expiresAt.toISOString() }
}

export async function decideDevice(db: Database, consenter: Consenter, code: string, body: DeviceDecisionBody, now = new Date()): Promise<DeviceDecision> {
  const person = await requireConsenter(db, consenter)
  const { grant, client } = await pendingDevice(db, code, now)
  const member = body.decision === "deny" ? null : await grantMember(db, person, body, client)
  const [decided] = await db
    .update(oauthGrants)
    .set(member === null ? { state: "denied", approvedBy: person.name } : { state: "approved", member, channels: body.channels, approvedBy: person.name })
    .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.state, "pending")))
    .returning({ id: oauthGrants.id })
  if (!decided) throw wrongState("That code was decided already")
  return { status: member === null ? "denied" : "approved", member }
}
