import { github } from "./github"
import type { CodeHost } from "./host"

export type { CodeHost, CodeHostEvent } from "./host"

export const codeHosts: Record<string, CodeHost> = { github }

export const codeHostFor = (name: string): CodeHost | null => codeHosts[name] ?? null
