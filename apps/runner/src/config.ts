import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir, hostname } from "node:os"
import path from "node:path"
import { agentPermissions } from "@flockr/contracts/agents"
import { defaultClaimsFile } from "@flockr/cli/epochs"
import { z } from "zod"

export const runnerHome = path.join(homedir(), ".flockr")
export const configFile = process.env.FLOCKR_RUNNER_CONFIG ?? path.join(runnerHome, "runner.json")
export const stateFile = path.join(runnerHome, "runner-state.json")
export const sessionsFile = path.join(runnerHome, "runner-sessions.json")
export const shimDir = path.join(runnerHome, "bin")
export const cliNames = ["flockr", "fc"] as const
export const claimsFile = process.env.FC_STATE ?? defaultClaimsFile
export const inheritedPath = process.env.PATH ?? "/usr/bin:/bin"
export const quiet = process.env.FLOCKR_RUNNER_QUIET === "1"
export const noRunner = process.env.FLOCKR_NO_RUNNER === "1"
export const defaultBoard = "http://localhost:5173"

const repoRoot = path.resolve(import.meta.dir, "../../..")
export const cliEntry = path.join(repoRoot, "apps/cli/src/main.ts")
export const skillFile = path.join(repoRoot, "skills/flockr/SKILL.md")
export const bridgeEntry = path.join(import.meta.dir, "bridge.ts")
export const runnerEntry = path.join(import.meta.dir, "main.ts")
export const webDir = path.join(repoRoot, "apps/web")
export const bunBinary = process.execPath

export const leaseRenewMs = 5 * 60_000
export const boardRetryMs = 2_000
export const callTimeoutMs = 20_000

export const childEnv = (extra: Record<string, string>): Record<string, string> => ({ ...inherited(Object.keys(process.env)), ...extra })

export function inherited(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] ?? ""]])))
}

export const isFolder = (folder: string) => existsSync(folder) && statSync(folder).isDirectory()

export const agentsHome = path.join(runnerHome, "agents")
export const agentStateFile = (member: string) => path.join(agentsHome, member, "agent.sqlite")

export const ModelEndpointConfig = z.object({
  baseUrl: z.url().default("https://openrouter.ai/api/v1"),
  keyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default("OPENROUTER_API_KEY"),
  defaultModel: z.string().trim().min(1).nullable().default(null),
  contextWindow: z.number().int().min(1000).default(128_000),
  maxTokens: z.number().int().min(256).default(8192),
})

export type ModelEndpointConfig = z.infer<typeof ModelEndpointConfig>

export interface BuiltInModel extends ModelEndpointConfig {
  key: string | null
  problem: string | null
}

const channelName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)
const absolute = z.string().refine((folder) => path.isAbsolute(folder), { error: "Each channel folder must be an absolute path" })

export const RunnerConfig = z.object({
  board: z.url().default(defaultBoard),
  machine: z.string().trim().min(1).optional(),
  channels: z.record(channelName, absolute).default({}),
  maxSessions: z.number().int().min(1).max(8).default(2),
  maxMinutes: z.number().int().min(1).max(240).default(30),
  member: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  harness: z.string().min(1).optional(),
})

export type RunnerConfig = z.infer<typeof RunnerConfig>

const ModelsSection = z.object({ models: ModelEndpointConfig.prefault({}) })

export function builtInModel(file: string = configFile): BuiltInModel {
  let raw: unknown = {}
  try {
    raw = readRaw(file)
  } catch {
    raw = {}
  }
  const parsed = ModelsSection.safeParse(raw)
  const models = parsed.success ? parsed.data.models : ModelEndpointConfig.parse({})
  const problem = parsed.success ? null : `models in ${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
  return { ...models, key: process.env[models.keyEnv]?.trim() || null, problem }
}

export interface LegacyAgent {
  member: string
  harness: string
}

export const legacyAgent = (config: RunnerConfig): LegacyAgent | null =>
  config.member !== undefined && config.harness !== undefined ? { member: config.member, harness: config.harness } : null

export class ConfigError extends Error {}

export function parseConfig(raw: unknown, folderExists: (folder: string) => boolean = isFolder): RunnerConfig {
  const parsed = RunnerConfig.safeParse(raw)
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; "))
  const missing = Object.entries(parsed.data.channels).filter(([, folder]) => !folderExists(folder))
  if (missing.length) throw new ConfigError(missing.map(([channel, folder]) => `channels.${channel}: folder ${folder} does not exist`).join("; "))
  return parsed.data
}

export function readRaw(file: string): unknown {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new ConfigError(`${file} is not valid JSON`)
  }
}

export const loadConfig = (file: string): RunnerConfig => parseConfig(readRaw(file))

export function machineIdentity(config: RunnerConfig, host: string = hostname()): { id: string; name: string } {
  const name = config.machine ?? host.replace(/\.local$/, "")
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "this-mac"
  return { id, name }
}

export const folderFor = (config: Pick<RunnerConfig, "channels">, channel: string): string | null => config.channels[channel] ?? null

const BridgeEnv = z.object({
  FC_URL: z.url(),
  FC_AS: z.string().min(1),
  FLOCKR_THREAD: z.string().min(1),
  FLOCKR_HARNESS: z.string().min(1),
  FLOCKR_PERMISSIONS: z.enum(agentPermissions),
})

export function bridgeEnv() {
  const env = BridgeEnv.parse(process.env)
  return { url: env.FC_URL, member: env.FC_AS, thread: env.FLOCKR_THREAD, harness: env.FLOCKR_HARNESS, permissions: env.FLOCKR_PERMISSIONS }
}
