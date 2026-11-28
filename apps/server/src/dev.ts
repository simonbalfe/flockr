import type { IncomingMessage } from "node:http"
import path from "node:path"
import type { Duplex } from "node:stream"
import { livePath } from "@flockr/contracts"
import devServer from "@hono/vite-dev-server"
import type { Plugin } from "vite"
import { WebSocketServer } from "ws"
import { createAuthenticator, liveViewer } from "./auth/identity"
import { localAuthSettings } from "./auth/local"
import { databaseUrl } from "./config"
import { devConnection } from "./dev-connection"
import { parseSince, type LiveSocket } from "./live/hub"
import { startLive } from "./live/runtime"
import { bridgeSettingsFrom } from "./chat-bridges"

const servedByHono = /^(?!\/(api|mcp|\.well-known)(\/|\?|$)).*/

function liveSocketPlugin(): Plugin {
  return {
    name: "flockr-live",
    async configureServer(server) {
      const httpServer = server.httpServer
      if (!httpServer) return
      const live = await startLive(databaseUrl, bridgeSettingsFrom(process.env))
      const wss = new WebSocketServer({ noServer: true })
      const auth = createAuthenticator(devConnection().db, localAuthSettings())
      const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        const headers = new Headers()
        for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value)
        const viewer = await liveViewer(auth, { headers, url })
        if (viewer instanceof Response) {
          socket.end(`HTTP/1.1 ${viewer.status} ${viewer.statusText || "Refused"}\r\nConnection: close\r\n\r\n`)
          return
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          const liveSocket: LiveSocket = { send: (text) => ws.send(text), close: () => ws.close(1008, "access ended") }
          ws.on("close", () => live.hub.detach(liveSocket))
          live.hub.attach(liveSocket, parseSince(url), viewer).catch((error: unknown) => {
            console.error("live attach failed", error)
            ws.close(1011, "attach failed")
          })
        })
      }
      httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (new URL(request.url ?? "/", "http://localhost").pathname !== livePath) return
        upgrade(request, socket, head).catch((error: unknown) => {
          console.error("live upgrade failed", error)
          socket.destroy()
        })
      })
      httpServer.on("close", () => void live.stop())
    },
  }
}

export function flockrDevServer(): Plugin[] {
  return [devServer({ entry: path.resolve(import.meta.dirname, "dev-app.ts"), exclude: [servedByHono], injectClientScript: false }), liveSocketPlugin()]
}
