import { boardId } from "../../config"
import { createApp } from "../../app"
import { hookSettingsFrom } from "../../board/hook-route"
import { bridgeSettingsFrom } from "../../chat-bridges"
import { hostedAgents } from "../../board/machines"
import type { Database } from "../../db/client"
import { modelProxySettingsFrom } from "../../model-proxy/proxy"
import { s3SettingsFrom, s3Store } from "../../storage/s3"
import { signalsPath } from "./board-room"
import { connectWorker } from "./db"
import { workerAuth, type WorkerEnv } from "./env"
import { collectSignals } from "./live"

export interface Waits {
  waitUntil: (work: Promise<unknown>) => void
}

export const pokePath = "/poke"
export const agentParam = "agent"

const bucketOf = (env: WorkerEnv) => {
  const settings = s3SettingsFrom(env)
  return settings ? s3Store(settings) : null
}

export const boardRoom = (env: WorkerEnv) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId))

export const cloudAgentObject = (env: WorkerEnv, agent: string) => env.CLOUD_AGENT.get(env.CLOUD_AGENT.idFromName(agent))

export function pokeCloudAgents(env: WorkerEnv, waits: Waits, names: readonly string[]): void {
  for (const agent of names) waits.waitUntil(cloudAgentObject(env, agent).fetch(`https://cloud-agent${pokePath}?${agentParam}=${encodeURIComponent(agent)}`, { method: "POST" }))
}

interface BoardWork<T> {
  run: (db: Database) => Promise<T>
  delivered: (result: T) => boolean
  from?: string
}

export async function onBoard<T>(env: WorkerEnv, waits: Waits, { run, delivered, from }: BoardWork<T>): Promise<T> {
  const connection = connectWorker(env.HYPERDRIVE.connectionString)
  try {
    const { result, signals } = await collectSignals(() => run(connection.db))
    if (signals.length && delivered(result)) {
      waits.waitUntil(boardRoom(env).fetch(`https://board-room${signalsPath}`, { method: "POST", body: JSON.stringify(signals) }))
      pokeCloudAgents(env, waits, (await hostedAgents(connection.db)).filter((name) => name !== from))
    }
    return result
  } finally {
    waits.waitUntil(connection.close())
  }
}

export function serveApi(env: WorkerEnv, waits: Waits, request: Request, from?: string): Promise<Response> {
  const auth = workerAuth(env, request)
  return onBoard(env, waits, {
    run: async (db) => createApp(db, { auth, modelProxy: modelProxySettingsFrom(env, auth.secret), hooks: hookSettingsFrom(env), bridges: bridgeSettingsFrom(env), objects: bucketOf(env) }).fetch(request),
    delivered: (response) => response.ok,
    from,
  })
}
