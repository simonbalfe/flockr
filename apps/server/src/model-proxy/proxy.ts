import { z } from "zod"

// The model key never enters a sandbox (ADR 0007, PL8). A box gets a short-lived box token and
// calls the board at /api/model/...; the board checks the token, swaps it for the real key and
// forwards the call to the model provider's base URL. No provider is named here: the base URL,
// the key and the header it goes in are settings.

export const modelProxyPath = "/api/model"
const tokenPrefix = "fbx_"

export const ModelProxyEnv = z.object({
  FLOCKR_MODEL_BASE_URL: z.url(),
  FLOCKR_MODEL_KEY: z.string().min(1),
  // "authorization" sends `Bearer <key>`; any other header name gets the bare key.
  FLOCKR_MODEL_KEY_HEADER: z.string().min(1).default("authorization"),
})

export interface ModelProxySettings {
  baseUrl: string
  key: string
  keyHeader: string
  // Signs box tokens; the board's sign-in secret.
  secret: string
  fetch?: typeof fetch
}

// Null when no model is set up, so the proxy route answers 404.
export function modelProxySettingsFrom(env: Record<string, unknown>, secret: string): ModelProxySettings | null {
  if (typeof env.FLOCKR_MODEL_BASE_URL !== "string" || env.FLOCKR_MODEL_BASE_URL === "") return null
  const parsed = ModelProxyEnv.parse(env)
  return { baseUrl: parsed.FLOCKR_MODEL_BASE_URL, key: parsed.FLOCKR_MODEL_KEY, keyHeader: parsed.FLOCKR_MODEL_KEY_HEADER.toLowerCase(), secret }
}

const BoxClaims = z.object({ box: z.string().min(1), exp: z.number().int() })
export type BoxClaims = z.infer<typeof BoxClaims>

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(plain.length)
  for (let i = 0; i < plain.length; i++) bytes[i] = plain.charCodeAt(i)
  return bytes
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(`flockr-model-proxy:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

// One token per box, valid until the box's own time limit.
export async function issueBoxToken(secret: string, claims: { box: string; expiresAt: Date }): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify({ box: claims.box, exp: claims.expiresAt.getTime() })))
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(body)))
  return `${tokenPrefix}${body}.${base64url(signature)}`
}

export async function verifyBoxToken(secret: string, token: string, now: Date): Promise<BoxClaims | null> {
  if (!token.startsWith(tokenPrefix)) return null
  const [body, signature, extra] = token.slice(tokenPrefix.length).split(".")
  if (!body || !signature || extra !== undefined) return null
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), fromBase64url(signature), encoder.encode(body))
    if (!valid) return null
    const claims = BoxClaims.parse(JSON.parse(new TextDecoder().decode(fromBase64url(body))))
    return claims.exp > now.getTime() ? claims : null
  } catch {
    return null
  }
}

// Whatever header the harness in the box sends its key in.
function presentedToken(headers: Headers): string | null {
  const auth = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "")?.[1]
  return auth ?? headers.get("x-api-key") ?? headers.get("api-key")
}

// Headers that carry the box's identity or the board's, never sent on.
const dropped = new Set(["authorization", "x-api-key", "api-key", "cookie", "host", "content-length", "x-flockr-member", "connection"])

const refuse = (status: number, error: string) => Response.json({ error, kind: status === 401 ? "unauthenticated" : "not_found" }, { status })

export async function proxyModel(request: Request, settings: ModelProxySettings | null, now: Date): Promise<Response> {
  if (!settings) return refuse(404, "No model is set up on this board (FLOCKR_MODEL_BASE_URL)")
  const token = presentedToken(request.headers)
  if (!token || !(await verifyBoxToken(settings.secret, token, now))) return refuse(401, "A live box token is needed to reach the model")

  const url = new URL(request.url)
  const rest = url.pathname.slice(modelProxyPath.length)
  const upstream = new URL(`${settings.baseUrl.replace(/\/$/, "")}${rest}${url.search}`)
  const headers = new Headers()
  for (const [name, value] of request.headers) if (!dropped.has(name.toLowerCase())) headers.set(name, value)
  headers.set(settings.keyHeader, settings.keyHeader === "authorization" ? `Bearer ${settings.key}` : settings.key)

  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const response = await (settings.fetch ?? fetch)(upstream, { method: request.method, headers, ...(hasBody ? { body: await request.arrayBuffer() } : {}) })
  const out = new Headers(response.headers)
  out.delete("content-encoding")
  out.delete("content-length")
  return new Response(response.body, { status: response.status, headers: out })
}
