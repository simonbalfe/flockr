import { livePath } from "@flockr/contracts"
import { createApp } from "./app"
import { createAuthenticator, refuseLive } from "./auth/identity"
import { backUp } from "./backup/backup"
import { drainJobs } from "./board/drain"
import { sweepOnce } from "./live/sweeper"
import { boardId } from "./config"
import type { Database } from "./db/client"
import { useLiveSignals } from "./platform"
import { signalsPath } from "./platform/cloudflare/board-room"
import { connectWorker } from "./platform/cloudflare/db"
import { WorkerEnv, workerAuth } from "./platform/cloudflare/env"
import { cloudflareSignals, collectSignals } from "./platform/cloudflare/live"
import { hookSettingsFrom } from "./board/hook-route"
import { modelProxySettingsFrom } from "./model-proxy/proxy"
import { s3SettingsFrom, s3Store } from "./storage/s3"

export { BoardRoom } from "./platform/cloudflare/board-room"

useLiveSignals(cloudflareSignals)

const backupCron = "0 3 * * *"

async function nightlyBackup(env: WorkerEnv): Promise<void> {
  const settings = s3SettingsFrom(env)
  if (!settings) return console.log("backup: skipped, no FLOCKR_S3_BUCKET")
  const connection = connectWorker(env.HYPERDRIVE.connectionString)
  try {
    const result = await backUp(connection.sql, s3Store(settings), new Date())
    console.log(`backup: ${result.key}, ${result.rows} rows, ${result.bytes} bytes, removed ${result.removed.length} old`)
  } finally {
    await connection.close()
  }
}

const bucketOf = (env: WorkerEnv) => {
  const settings = s3SettingsFrom(env)
  return settings ? s3Store(settings) : null
}

const boardRoom = (env: WorkerEnv) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId))

interface BoardWork<T> {
  run: (db: Database) => Promise<T>
  delivered: (result: T) => boolean
}

async function onBoard<T>(env: WorkerEnv, ctx: ExecutionContext, { run, delivered }: BoardWork<T>): Promise<T> {
  const connection = connectWorker(env.HYPERDRIVE.connectionString)
  try {
    const { result, signals } = await collectSignals(() => run(connection.db))
    if (signals.length && delivered(result)) {
      ctx.waitUntil(boardRoom(env).fetch(`https://board-room${signalsPath}`, { method: "POST", body: JSON.stringify(signals) }))
    }
    return result
  } finally {
    ctx.waitUntil(connection.close())
  }
}

export default {
  async fetch(request: Request, rawEnv: unknown, ctx: ExecutionContext): Promise<Response> {
    const env = WorkerEnv.parse(rawEnv)
    const url = new URL(request.url)
    const auth = workerAuth(env, request)
    if (url.pathname === livePath) {
      const refused = auth.mode === "on" ? await onBoard(env, ctx, { run: (db) => refuseLive(createAuthenticator(db, auth), request.headers), delivered: () => false }) : null
      return refused ?? boardRoom(env).fetch(request)
    }
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp") return new Response("Not found", { status: 404 })
    return onBoard(env, ctx, { run: async (db) => createApp(db, { auth, modelProxy: modelProxySettingsFrom(env, auth.secret), hooks: hookSettingsFrom(env), objects: bucketOf(env) }).fetch(request), delivered: (response) => response.ok })
  },
  async scheduled(controller: ScheduledController, rawEnv: unknown, ctx: ExecutionContext): Promise<void> {
    const env = WorkerEnv.parse(rawEnv)
    if (controller.cron === backupCron) return nightlyBackup(env)
    const drained = await onBoard(env, ctx, {
      run: async (db) => {
        await sweepOnce(db)
        return drainJobs(db)
      },
      delivered: () => true,
    })
    if (drained.ran || drained.failed) console.log(`jobs: ${drained.ran} ran, ${drained.retrying} to retry, ${drained.failed} failed`)
  },
}
