import type { CodeHostEventKind } from "@flockr/contracts"

// Where a channel's code lives (5e). One interface, one adapter per host, one entry in
// `codeHosts`; nothing outside an adapter names a host or branches on its name.

export interface CodeHostEvent {
  kind: CodeHostEventKind
  // host and path, the same shape as a channel's repo: github.com/simonbalfe/flockr
  repo: string
  number: number
  title: string
  url: string
  author: string
  // The pull request's branch when the payload carries it; flockr/<task> links it to a task.
  branch: string | null
  body: string | null
  mergeSha: string | null
}

export interface CodeHost {
  readonly name: string
  // The bridge member whose replies carry this host's events.
  readonly memberName: string
  deliveryId: (headers: Headers) => string | null
  verify: (headers: Headers, body: string, secret: string) => Promise<boolean>
  // Null for deliveries a thread does not care about (pings, labels, pushes).
  parse: (headers: Headers, body: string) => CodeHostEvent | null
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Compares every character, so the time taken says nothing about where they differ.
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
