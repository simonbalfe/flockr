import type { z } from "zod"

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

export interface Signer {
  prefix: string
  purpose: string
}

async function signingKey(secret: string, purpose: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(`${purpose}:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

export async function signToken<C extends { exp: number }>(signer: Signer, secret: string, claims: C): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(claims)))
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret, signer.purpose), encoder.encode(body)))
  return `${signer.prefix}${body}.${base64url(signature)}`
}

export async function verifyToken<S extends z.ZodType<{ exp: number }>>(signer: Signer, schema: S, secret: string, token: string, now: Date): Promise<z.infer<S> | null> {
  if (!token.startsWith(signer.prefix)) return null
  const [body, signature, extra] = token.slice(signer.prefix.length).split(".")
  if (!body || !signature || extra !== undefined) return null
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret, signer.purpose), fromBase64url(signature), encoder.encode(body))
    if (!valid) return null
    const claims = schema.parse(JSON.parse(new TextDecoder().decode(fromBase64url(body))))
    return claims.exp > now.getTime() ? claims : null
  } catch {
    return null
  }
}
