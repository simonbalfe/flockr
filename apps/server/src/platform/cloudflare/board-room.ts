import { DurableObject } from "cloudflare:workers"
import { z } from "zod"
import { createHub, parseSince, type Hub, type LiveSocket } from "../../live/hub"
import { LiveSignal, pushListener } from "../live"
import { connectWorker } from "./db"
import { WorkerEnv } from "./env"

export const signalsPath = "/signals"
const SignalList = z.array(LiveSignal)

export class BoardRoom extends DurableObject {
  private readonly feed = pushListener()
  private hub: Promise<Hub> | undefined

  private board(): Promise<Hub> {
    this.hub ??= (async () => {
      const env = WorkerEnv.parse(this.env)
      const hub = createHub(connectWorker(env.HYPERDRIVE.connectionString).db, this.feed.listener)
      await hub.ready
      return hub
    })()
    return this.hub
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const hub = await this.board()
    if (request.headers.get("Upgrade") === "websocket") return this.openSocket(hub, parseSince(url))
    if (request.method === "POST" && url.pathname === signalsPath) {
      for (const signal of SignalList.parse(await request.json())) this.feed.push(signal)
      return new Response(null, { status: 204 })
    }
    return new Response("Not found", { status: 404 })
  }

  private openSocket(hub: Hub, since: number | null): Response {
    const [client, server] = Object.values(new WebSocketPair())
    if (!client || !server) throw new Error("WebSocketPair did not return two sockets")
    server.accept()
    const socket: LiveSocket = { send: (text) => server.send(text) }
    const leave = () => hub.detach(socket)
    server.addEventListener("close", leave)
    server.addEventListener("error", leave)
    hub.attach(socket, since).catch((error: unknown) => {
      console.error("live attach failed", error)
      server.close(1011, "attach failed")
    })
    return new Response(null, { status: 101, webSocket: client })
  }
}
