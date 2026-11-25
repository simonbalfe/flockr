import path from "node:path"
import { livePath } from "@flockr/contracts"
import { createApp } from "./app"
import { databaseUrl, host, port } from "./config"
import { connect } from "./db/client"
import { parseSince, type LiveSocket } from "./live/hub"
import { startLive } from "./live/runtime"

const dist = path.resolve(import.meta.dirname, "../../web/dist")
const index = Bun.file(path.join(dist, "index.html"))

if (!(await index.exists())) {
  console.error(`No web build at ${dist}. Run bun run build first.`)
  process.exit(1)
}

const connection = connect(databaseUrl)
const app = createApp(connection.db)
const live = await startLive(databaseUrl)

async function staticFile(pathname: string): Promise<Response> {
  const target = path.resolve(dist, `.${decodeURIComponent(pathname)}`)
  if (target.startsWith(`${dist}${path.sep}`)) {
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file)
  }
  return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } })
}

const server = Bun.serve<{ since: number | null; socket?: LiveSocket }>({
  hostname: host,
  port,
  fetch(request, srv) {
    const url = new URL(request.url)
    if (url.pathname === livePath) {
      if (srv.upgrade(request, { data: { since: parseSince(url) } })) return undefined
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") return app.fetch(request)
    return staticFile(url.pathname)
  },
  websocket: {
    open(ws) {
      const socket: LiveSocket = { send: (text) => void ws.send(text) }
      ws.data.socket = socket
      live.hub.attach(socket, ws.data.since).catch((error: unknown) => {
        console.error("live attach failed", error)
        ws.close(1011, "attach failed")
      })
    },
    message() {},
    close(ws) {
      if (ws.data.socket) live.hub.detach(ws.data.socket)
    },
  },
})

console.log(`Flockr on http://${server.hostname}:${server.port} (no authentication: bound to ${host})`)

const shutdown = async () => {
  await server.stop()
  await live.stop()
  await connection.close()
  process.exit(0)
}
process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())
