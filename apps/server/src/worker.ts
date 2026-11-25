import { livePath } from "@flockr/contracts"
import { createApp } from "./app"
import { boardId } from "./config"
import { useLiveSignals } from "./platform"
import { signalsPath } from "./platform/cloudflare/board-room"
import { connectWorker } from "./platform/cloudflare/db"
import { WorkerEnv } from "./platform/cloudflare/env"
import { cloudflareSignals, collectSignals } from "./platform/cloudflare/live"

export { BoardRoom } from "./platform/cloudflare/board-room"

useLiveSignals(cloudflareSignals)

const boardRoom = (env: WorkerEnv) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId))

export default {
  async fetch(request: Request, rawEnv: unknown, ctx: ExecutionContext): Promise<Response> {
    const env = WorkerEnv.parse(rawEnv)
    const url = new URL(request.url)
    if (url.pathname === livePath) return boardRoom(env).fetch(request)
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp") return new Response("Not found", { status: 404 })
    const connection = connectWorker(env.HYPERDRIVE.connectionString)
    try {
      const { result: response, signals } = await collectSignals(async () => createApp(connection.db).fetch(request))
      if (signals.length && response.ok) {
        ctx.waitUntil(boardRoom(env).fetch(`https://board-room${signalsPath}`, { method: "POST", body: JSON.stringify(signals) }))
      }
      return response
    } finally {
      ctx.waitUntil(connection.close())
    }
  },
}
