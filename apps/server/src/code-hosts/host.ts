import type { CodeHostEventKind } from "@flockr/contracts"


export interface CodeHostEvent {
  kind: CodeHostEventKind
  repo: string
  number: number
  title: string
  url: string
  author: string
  branch: string | null
  body: string | null
  mergeSha: string | null
}

export interface CodeHost {
  readonly name: string
  readonly memberName: string
  deliveryId: (headers: Headers) => string | null
  verify: (headers: Headers, body: string, secret: string) => Promise<boolean>
  parse: (headers: Headers, body: string) => CodeHostEvent | null
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
