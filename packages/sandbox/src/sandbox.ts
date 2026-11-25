import { z } from "zod"


export const networkPolicies = ["none", "open"] as const
export const NetworkPolicy = z.enum(networkPolicies)
export type NetworkPolicy = z.infer<typeof NetworkPolicy>

export const SandboxSpec = z.object({
  image: z.string().min(1),
  timeLimitSeconds: z.number().int().positive().max(24 * 60 * 60),
  diskMb: z.number().int().positive().max(64 * 1024),
  memoryMb: z.number().int().positive().default(2048),
  cpus: z.number().positive().default(2),
  network: NetworkPolicy.default("open"),
  env: z.record(z.string(), z.string()).default({}),
  labels: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), z.string()).default({}),
})
export type SandboxSpec = z.input<typeof SandboxSpec>

export const sandboxStates = ["running", "stopped", "missing"] as const
export type SandboxState = (typeof sandboxStates)[number]

export interface SandboxInfo {
  id: string
  state: SandboxState
  expiresAt: Date
  labels: Record<string, string>
}

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  stdin?: Uint8Array | string
  timeoutSeconds?: number
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface SandboxCapabilities {
  sleepsWhenIdle: boolean
  persistentDisk: boolean
  maxSessionSeconds: number
  networkPolicies: readonly NetworkPolicy[]
}

export interface SandboxProvider {
  readonly name: string
  readonly capabilities: SandboxCapabilities
  start: (spec: SandboxSpec) => Promise<SandboxInfo>
  run: (id: string, command: string[], options?: RunOptions) => Promise<RunResult>
  writeFile: (id: string, path: string, content: Uint8Array | string) => Promise<void>
  readFile: (id: string, path: string) => Promise<Uint8Array | null>
  status: (id: string) => Promise<SandboxInfo>
  logs: (id: string) => Promise<string>
  stop: (id: string) => Promise<void>
  list: () => Promise<SandboxInfo[]>
}

export async function sweepSandboxes(provider: SandboxProvider, now: Date): Promise<string[]> {
  const expired = (await provider.list()).filter((box) => box.expiresAt.getTime() <= now.getTime())
  for (const box of expired) await provider.stop(box.id)
  return expired.map((box) => box.id)
}
