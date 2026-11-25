import path from "node:path"
import { livePath } from "@flockr/contracts"
import devServer from "@hono/vite-dev-server"
import type { Plugin } from "vite"
import { WebSocketServer } from "ws"
import { databaseUrl } from "./config"
import { parseSince, type LiveSocket } from "./live/hub"
import { startLive } from "./live/runtime"

const servedByHono = /^(?!\/(api|mcp)(\/|\?|$)).*/

function liveSocketPlugin(): Plugin {
  return {
    name: "flockr-live",
    async configureServer(server) {
      const httpServer = server.httpServer
      if (!httpServer) return
      const live = await startLive(databaseUrl)
      const wss = new WebSocketServer({ noServer: true })
      httpServer.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        if (url.pathname !== livePath) return
        wss.handleUpgrade(request, socket, head, (ws) => {
          const liveSocket: LiveSocket = { send: (text) => ws.send(text) }
          ws.on("close", () => live.hub.detach(liveSocket))
          live.hub.attach(liveSocket, parseSince(url)).catch((error: unknown) => {
            console.error("live attach failed", error)
            ws.close(1011, "attach failed")
          })
        })
      })
      httpServer.on("close", () => void live.stop())
    },
  }
}

export function flockrDevServer(): Plugin[] {
  return [devServer({ entry: path.resolve(import.meta.dirname, "dev-app.ts"), exclude: [servedByHono], injectClientScript: false }), liveSocketPlugin()]
}
