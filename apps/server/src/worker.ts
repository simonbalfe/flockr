import { livePath } from "@flockr/contracts"
import { createApp } from "./app"
import { connectWorker } from "./platform/cloudflare/db"
import { type WorkerContext, WorkerEnv } from "./platform/cloudflare/env"

export default {
  async fetch(request: Request, rawEnv: unknown, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === livePath) return new Response("Live events on Cloudflare arrive with the board room object (PL3)", { status: 501 })
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp") return new Response("Not found", { status: 404 })
    const env = WorkerEnv.parse(rawEnv)
    const connection = connectWorker(env.HYPERDRIVE.connectionString)
    try {
      return await createApp(connection.db).fetch(request)
    } finally {
      ctx.waitUntil(connection.close())
    }
  },
}
