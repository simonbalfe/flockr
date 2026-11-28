import type { SqliteDatabase } from "@earendil-works/chord/sqlite"
import type { HarnessSettings } from "@earendil-works/pi-durable"
import type { Agent, AgentDetail, AgentReportEntry } from "@flockr/contracts"
import { cloudHarness, createCloudAgent, type CloudAgent } from "@flockr/runner/cloud"
import type { SandboxProvider, SandboxSpec } from "@flockr/sandbox/sandbox"
import { issueAgentToken } from "../auth/agent-token"
import { getAgent, listAgents } from "../board/agents"
import { BoardError } from "../board/errors"
import { reportHostedAgent, type HostedMachine } from "../board/machines"
import type { Database } from "../db/client"
import { issueBoxToken, modelProxyPath } from "../model-proxy/proxy"

export const cloudMachine: HostedMachine = { id: "cloud", name: "Cloud", harnesses: [cloudHarness] }

export const cloudBoardUrl = "https://board.flockr.internal"

export const cloudModelLimits = { contextWindow: 128_000, maxTokens: 8192, tokenMinutes: 15 } as const

export const cloudBoxSpec = { image: "box", timeLimitSeconds: 4 * 60 * 60, diskMb: 4096, memoryMb: 2048, cpus: 1, network: "open" } as const satisfies SandboxSpec

export type WithDb = <T>(run: (db: Database) => Promise<T>) => Promise<T>

export interface CloudHostOptions {
  agent: string
  serve: (request: Request) => Promise<Response>
  withDb: WithDb
  secret: string
  database: SqliteDatabase
  model: { ready: boolean; defaultModel: string | null }
  log: (line: string) => void
  wakes?: Parameters<typeof createCloudAgent>[0]["wakes"]
  timers?: Parameters<typeof createCloudAgent>[0]["timers"]
  settings?: HarnessSettings
  boxes?: { provider: SandboxProvider; spec?: SandboxSpec } | null
}

function signed(serve: (request: Request) => Promise<Response>, token: () => Promise<string>): typeof fetch {
  const signedFetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    headers.set("authorization", `Bearer ${await token()}`)
    return serve(new Request(request, { headers }))
  }
  return Object.assign(signedFetch, { preconnect: () => undefined })
}

async function agentOf(withDb: WithDb, name: string): Promise<AgentDetail | null> {
  try {
    return await withDb((db) => getAgent(db, name))
  } catch (error) {
    if (error instanceof BoardError && error.kind === "not_found") return null
    throw error
  }
}

export async function hostCloudAgent(options: CloudHostOptions): Promise<CloudAgent | null> {
  const { agent, withDb, secret } = options
  const found = await agentOf(withDb, agent)
  const machine = found?.config?.machine
  if (!found || !machine) return null
  const hosted = await withDb(async (db) => (await listAgents(db, { machine })).some((a) => a.name === agent))
  if (!hosted) return null

  const own = async (db: Database, reports: readonly { name: string; state: AgentReportEntry["state"]; reason?: string | null }[] | undefined): Promise<Agent[]> => {
    const entry = (reports ?? []).find((a) => a.name === agent)
    const reported = entry ? await reportHostedAgent(db, { name: entry.name, state: entry.state, reason: entry.reason ?? null }) : null
    if (reported) return [reported]
    return (await listAgents(db, { machine })).filter((a) => a.name === agent)
  }

  return createCloudAgent({
    member: agent,
    machine: { id: machine, name: found.config?.machineName ?? machine },
    board: { baseUrl: cloudBoardUrl, fetch: signed(options.serve, () => issueAgentToken(secret, agent)) },
    model: {
      baseUrl: `${cloudBoardUrl}${modelProxyPath}`,
      fetch: signed(options.serve, () => issueBoxToken(secret, { box: `agent:${agent}`, expiresAt: new Date(Date.now() + cloudModelLimits.tokenMinutes * 60_000) })),
      defaultModel: options.model.defaultModel,
      known: found.config?.model ? [found.config.model] : [],
      problem: options.model.ready ? null : "no model is set up on this board (FLOCKR_MODEL_BASE_URL)",
      contextWindow: cloudModelLimits.contextWindow,
      maxTokens: cloudModelLimits.maxTokens,
    },
    database: options.database,
    port: {
      register: async () => undefined,
      heartbeat: (_id, body) => withDb((db) => own(db, body.agents)),
      agent: (name) => agentOf(withDb, name),
      createAgent: async () => {
        throw new Error("a cloud agent does not create agents")
      },
    },
    log: options.log,
    wakes: options.wakes,
    timers: options.timers,
    settings: options.settings,
    boxes: options.boxes ? { provider: options.boxes.provider, spec: options.boxes.spec ?? cloudBoxSpec } : null,
  })
}
