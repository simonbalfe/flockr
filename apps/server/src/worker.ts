import { livePath } from "@flockr/contracts"
import { createApp } from "./app"
import { createAuthenticator, refuseLive } from "./auth/identity"
import { drainJobs } from "./board/drain"
import { boardId } from "./config"
import type { Database } from "./db/client"
import { useLiveSignals } from "./platform"
import { signalsPath } from "./platform/cloudflare/board-room"
import { connectWorker } from "./platform/cloudflare/db"
import { WorkerEnv, workerAuth } from "./platform/cloudflare/env"
import { cloudflareSignals, collectSignals } from "./platform/cloudflare/live"

export { BoardRoom } from "./platform/cloudflare/board-room"

useLiveSignals(cloudflareSignals)

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
    return onBoard(env, ctx, { run: async (db) => createApp(db, { auth }).fetch(request), delivered: (response) => response.ok })
  },
  async scheduled(_controller: ScheduledController, rawEnv: unknown, ctx: ExecutionContext): Promise<void> {
    const env = WorkerEnv.parse(rawEnv)
    const drained = await onBoard(env, ctx, { run: (db) => drainJobs(db), delivered: () => true })
    if (drained.ran || drained.failed) console.log(`jobs: ${drained.ran} ran, ${drained.retrying} to retry, ${drained.failed} failed`)
  },
}
