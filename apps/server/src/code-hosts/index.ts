import { github } from "./github"
import type { CodeHost } from "./host"

export type { CodeHost, CodeHostEvent } from "./host"

// The host list: adding one is an adapter plus one entry here.
export const codeHosts: Record<string, CodeHost> = { github }

export const codeHostFor = (name: string): CodeHost | null => codeHosts[name] ?? null
