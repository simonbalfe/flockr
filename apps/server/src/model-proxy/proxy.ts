import { z } from "zod"
import { signToken, verifyToken, type Signer } from "../auth/signed"

export const modelProxyPath = "/api/model"
const boxSigner: Signer = { prefix: "fbx_", purpose: "flockr-model-proxy" }

export const ModelProxyEnv = z.object({
  FLOCKR_MODEL_BASE_URL: z.url(),
  FLOCKR_MODEL_KEY: z.string().min(1),
  FLOCKR_MODEL_KEY_HEADER: z.string().min(1).default("authorization"),
})

export interface ModelProxySettings {
  baseUrl: string
  key: string
  keyHeader: string
  secret: string
  fetch?: typeof fetch
}

export function modelProxySettingsFrom(env: Record<string, unknown>, secret: string): ModelProxySettings | null {
  if (typeof env.FLOCKR_MODEL_BASE_URL !== "string" || env.FLOCKR_MODEL_BASE_URL === "") return null
  const parsed = ModelProxyEnv.parse(env)
  return { baseUrl: parsed.FLOCKR_MODEL_BASE_URL, key: parsed.FLOCKR_MODEL_KEY, keyHeader: parsed.FLOCKR_MODEL_KEY_HEADER.toLowerCase(), secret }
}

const BoxClaims = z.object({ box: z.string().min(1), exp: z.number().int() })
export type BoxClaims = z.infer<typeof BoxClaims>

export const issueBoxToken = (secret: string, claims: { box: string; expiresAt: Date }): Promise<string> => signToken(boxSigner, secret, { box: claims.box, exp: claims.expiresAt.getTime() })

export const verifyBoxToken = (secret: string, token: string, now: Date): Promise<BoxClaims | null> => verifyToken(boxSigner, BoxClaims, secret, token, now)

function presentedToken(headers: Headers): string | null {
  const auth = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "")?.[1]
  return auth ?? headers.get("x-api-key") ?? headers.get("api-key")
}

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
  const response = await (settings.fetch ?? fetch)(upstream, { method: request.method, headers, signal: request.signal, ...(hasBody ? { body: await request.arrayBuffer() } : {}) })
  const out = new Headers(response.headers)
  out.delete("content-encoding")
  out.delete("content-length")
  return new Response(response.body, { status: response.status, headers: out })
}
