import { DurableObject } from "cloudflare:workers"
import { z } from "zod"
import type { Viewer } from "../../board/visibility"
import { createHub, parseSince, type Hub, type LiveSocket, type SocketStore } from "../../live/hub"
import { LiveSignal, pushListener } from "../live"
import { connectWorker } from "./db"
import { WorkerEnv } from "./env"

export const signalsPath = "/signals"
export const viewerHeader = "x-flockr-live-viewer"
const SignalList = z.array(LiveSignal)
const ViewerSchema = z.object({ member: z.string(), channels: z.array(z.string()).nullable(), key: z.object({ id: z.string(), version: z.number().int() }).optional() })
const Attachment = z.object({ seq: z.number().int(), viewer: ViewerSchema })

function hibernatingSockets(ctx: DurableObjectState): SocketStore {
  const find = (socket: LiveSocket) => ctx.getWebSockets().find((open) => open === socket)
  return {
    list: () => ctx.getWebSockets(),
    seqOf: (socket) => Attachment.safeParse(find(socket)?.deserializeAttachment()).data?.seq,
    viewerOf: (socket) => Attachment.safeParse(find(socket)?.deserializeAttachment()).data?.viewer,
    start: (socket, seq, viewer) => find(socket)?.serializeAttachment({ seq, viewer }),
    setSeq: (socket, seq) => {
      const open = find(socket)
      const current = Attachment.safeParse(open?.deserializeAttachment()).data
      if (open && current) open.serializeAttachment({ ...current, seq })
    },
    remove: (socket) => find(socket)?.serializeAttachment(null),
    clear: () => undefined,
    size: () => ctx.getWebSockets().length,
  }
}

export class BoardRoom extends DurableObject {
  private readonly feed = pushListener()
  private hub: Promise<Hub> | undefined

  private board(): Promise<Hub> {
    this.hub ??= (async () => {
      const env = WorkerEnv.parse(this.env)
      const hub = createHub(connectWorker(env.HYPERDRIVE.connectionString).db, this.feed.listener, hibernatingSockets(this.ctx))
      await hub.ready
      return hub
    })()
    return this.hub
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const hub = await this.board()
    if (request.headers.get("Upgrade") === "websocket") {
      const viewer = ViewerSchema.safeParse(JSON.parse(request.headers.get(viewerHeader) ?? "null"))
      if (!viewer.success) return new Response("No viewer", { status: 400 })
      return this.openSocket(hub, parseSince(url), viewer.data)
    }
    if (request.method === "POST" && url.pathname === signalsPath) {
      for (const signal of SignalList.parse(await request.json())) this.feed.push(signal)
      return new Response(null, { status: 204 })
    }
    return new Response("Not found", { status: 404 })
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const hub = await this.board()
    hub.detach(socket)
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    const hub = await this.board()
    hub.detach(socket)
  }

  private openSocket(hub: Hub, since: number | null, viewer: Viewer): Response {
    const [client, server] = Object.values(new WebSocketPair())
    if (!client || !server) throw new Error("WebSocketPair did not return two sockets")
    this.ctx.acceptWebSocket(server)
    hub.attach(server, since, viewer).catch((error: unknown) => {
      console.error("live attach failed", error)
      server.close(1011, "attach failed")
    })
    return new Response(null, { status: 101, webSocket: client })
  }
}
