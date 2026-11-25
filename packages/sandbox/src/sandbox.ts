import { z } from "zod"

// Where a cloud agent's work runs (ADRs 0007, 0019). One interface, one adapter per provider,
// one entry in `providers`; nothing outside an adapter names a provider or branches on its name.
// A sandbox keeps nothing that matters: work leaves it only as git pushes.

export const networkPolicies = ["none", "open"] as const
export const NetworkPolicy = z.enum(networkPolicies)
export type NetworkPolicy = z.infer<typeof NetworkPolicy>

export const SandboxSpec = z.object({
  image: z.string().min(1),
  // The box removes itself when this runs out, whatever happens to the caller.
  timeLimitSeconds: z.number().int().positive().max(24 * 60 * 60),
  // Everything the box may write (its home, the workspace and /tmp) fits in this.
  diskMb: z.number().int().positive().max(64 * 1024),
  memoryMb: z.number().int().positive().default(2048),
  cpus: z.number().positive().default(2),
  network: NetworkPolicy.default("open"),
  env: z.record(z.string(), z.string()).default({}),
  // Who the box is for, shown in listings: `{ task: "806", agent: "claude" }`.
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

// What a provider declares, so a feature reads this instead of the provider's name.
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
  // The command is an argument list, never a shell string, so nothing is re-parsed.
  run: (id: string, command: string[], options?: RunOptions) => Promise<RunResult>
  writeFile: (id: string, path: string, content: Uint8Array | string) => Promise<void>
  readFile: (id: string, path: string) => Promise<Uint8Array | null>
  status: (id: string) => Promise<SandboxInfo>
  logs: (id: string) => Promise<string>
  // Removes the box and everything in it; safe to repeat.
  stop: (id: string) => Promise<void>
  // Every box this provider holds for Flockr.
  list: () => Promise<SandboxInfo[]>
}

// Removes every box past its time limit; run it on the platform scheduler as a backstop
// to each box's own limit.
export async function sweepSandboxes(provider: SandboxProvider, now: Date): Promise<string[]> {
  const expired = (await provider.list()).filter((box) => box.expiresAt.getTime() <= now.getTime())
  for (const box of expired) await provider.stop(box.id)
  return expired.map((box) => box.id)
}
