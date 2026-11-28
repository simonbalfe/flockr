import path from "node:path"
import { livePath } from "@flockr/contracts"
import { createApp } from "./app"
import { liveViewer } from "./auth/identity"
import type { Viewer } from "./board/visibility"
import { localAuthSettings } from "./auth/local"
import { databaseUrl, host, objectsDir, port } from "./config"
import { localObjectStore } from "./storage/local"
import { connect } from "./db/client"
import { parseSince, type LiveSocket } from "./live/hub"
import { startLive } from "./live/runtime"
import { hookSettingsFrom } from "./board/hook-route"
import { bridgeSettingsFrom } from "./chat-bridges"
import { modelProxySettingsFrom } from "./model-proxy/proxy"

const dist = path.resolve(import.meta.dirname, "../../web/dist")
const index = Bun.file(path.join(dist, "index.html"))

if (!(await index.exists())) {
  console.error(`No web build at ${dist}. Run bun run build first.`)
  process.exit(1)
}

const connection = connect(databaseUrl)
const auth = localAuthSettings()
const app = createApp(connection.db, { auth, modelProxy: modelProxySettingsFrom(process.env, auth.secret), hooks: hookSettingsFrom(process.env), bridges: bridgeSettingsFrom(process.env), objects: localObjectStore(process.env, objectsDir()) })
const live = await startLive(databaseUrl, bridgeSettingsFrom(process.env))

async function staticFile(pathname: string): Promise<Response> {
  const target = path.resolve(dist, `.${decodeURIComponent(pathname)}`)
  if (target.startsWith(`${dist}${path.sep}`)) {
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file)
  }
  return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } })
}

const server = Bun.serve<{ since: number | null; viewer: Viewer; socket?: LiveSocket }>({
  hostname: host,
  port,
  async fetch(request, srv) {
    const url = new URL(request.url)
    if (url.pathname === livePath) {
      const viewer = await liveViewer(app.authenticator, { headers: request.headers, url })
      if (viewer instanceof Response) return viewer
      if (srv.upgrade(request, { data: { since: parseSince(url), viewer } })) return undefined
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/mcp" || url.pathname.startsWith("/.well-known/")) return app.fetch(request)
    return staticFile(url.pathname)
  },
  websocket: {
    open(ws) {
      const socket: LiveSocket = { send: (text) => void ws.send(text), close: () => ws.close(1008, "access ended") }
      ws.data.socket = socket
      live.hub.attach(socket, ws.data.since, ws.data.viewer).catch((error: unknown) => {
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

console.log(`Flockr on http://${server.hostname}:${server.port} (${auth.mode === "on" ? `sign-in on for ${auth.people.size} people` : `sign-in off: bound to ${host}`})`)

const shutdown = async () => {
  await server.stop()
  await live.stop()
  await connection.close()
  process.exit(0)
}
process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())
