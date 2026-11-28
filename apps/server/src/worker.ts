import { livePath } from "@flockr/contracts"
import { sweepSandboxes } from "@flockr/sandbox/sandbox"
import { createAuthenticator, headerIdentity, liveAsParam, liveViewer } from "./auth/identity"
import { viewerOf } from "./board/visibility"
import { viewerHeader } from "./platform/cloudflare/board-room"
import { backUp } from "./backup/backup"
import { drainJobs } from "./board/drain"
import { beatHostedMachine, hostedAgents } from "./board/machines"
import { cloudMachine } from "./cloud/host"
import { sweepOnce } from "./live/sweeper"
import { useLiveSignals } from "./platform"
import { boardRoom, onBoard, pokeCloudAgents, serveApi } from "./platform/cloudflare/api"
import { connectWorker } from "./platform/cloudflare/db"
import { WorkerEnv, workerAuth } from "./platform/cloudflare/env"
import { cloudflareSignals } from "./platform/cloudflare/live"
import { cloudflareSandbox } from "./platform/cloudflare/sandbox"
import { bridgeSettingsFrom } from "./chat-bridges"
import { modelProxySettingsFrom } from "./model-proxy/proxy"
import { s3SettingsFrom, s3Store } from "./storage/s3"

export { BoardRoom } from "./platform/cloudflare/board-room"
export { CloudAgent } from "./platform/cloudflare/cloud-agent"
export { SandboxBox, SandboxIndex } from "./platform/cloudflare/sandbox-box"

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

export default {
  async fetch(request: Request, rawEnv: unknown, ctx: ExecutionContext): Promise<Response> {
    const env = WorkerEnv.parse(rawEnv)
    const url = new URL(request.url)
    const auth = workerAuth(env, request)
    if (url.pathname === livePath) {
      const viewer = auth.mode === "on" ? await onBoard(env, ctx, { run: (db) => liveViewer(createAuthenticator(db, auth), { headers: request.headers, url }), delivered: () => false }) : viewerOf(url.searchParams.get(liveAsParam)?.trim() || headerIdentity(request.headers).member)
      if (viewer instanceof Response) return viewer
      const headers = new Headers(request.headers)
      headers.set(viewerHeader, JSON.stringify(viewer))
      return boardRoom(env).fetch(new Request(request, { headers }))
    }
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp" && !url.pathname.startsWith("/.well-known/")) return new Response("Not found", { status: 404 })
    return serveApi(env, ctx, request)
  },
  async scheduled(controller: ScheduledController, rawEnv: unknown, ctx: ExecutionContext): Promise<void> {
    const env = WorkerEnv.parse(rawEnv)
    if (controller.cron === backupCron) return nightlyBackup(env)
    const hostsAgents = modelProxySettingsFrom(env, workerAuth(env, null).secret) !== null
    const drained = await onBoard(env, ctx, {
      run: async (db) => {
        await sweepOnce(db)
        if (hostsAgents) await beatHostedMachine(db, cloudMachine)
        const result = await drainJobs(db, { bridges: bridgeSettingsFrom(env) })
        if (hostsAgents) pokeCloudAgents(env, ctx, await hostedAgents(db))
        return result
      },
      delivered: () => true,
    })
    const sandbox = cloudflareSandbox(env)
    if (sandbox) {
      const swept = await sweepSandboxes(sandbox, new Date())
      if (swept.length) console.log(`sandboxes: removed ${swept.length} past their time limit`)
    }
    if (drained.ran || drained.failed) console.log(`jobs: ${drained.ran} ran, ${drained.retrying} to retry, ${drained.failed} failed`)
  },
}
