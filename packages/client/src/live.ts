import { livePath } from "@flockr/contracts/constants"
import type { LiveFrame } from "@flockr/contracts"
import type { Activity, BoardEvent } from "./gen/types.gen"

export interface LiveOptions {
  baseUrl: string
  since?: number | null
  onEvent: (event: BoardEvent) => void
  onHello?: (head: number) => void
  onActivity?: (activity: Activity, working: boolean) => void
  onAgents?: (names: string[]) => void
  onStatus?: (connected: boolean) => void
}

export interface LiveConnection {
  close: () => void
  readonly lastSeq: number | null
}

function isFrame(value: unknown): value is LiveFrame {
  return typeof value === "object" && value !== null && "kind" in value && (value.kind === "hello" || value.kind === "event" || value.kind === "activity" || value.kind === "agents")
}

export function liveUrl(baseUrl: string, since: number | null): string {
  const url = new URL(livePath, baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  if (since !== null) url.searchParams.set("since", String(since))
  return url.toString()
}

export function connectLive(options: LiveOptions): LiveConnection {
  let lastSeq: number | null = options.since ?? null
  let socket: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let delay = 500

  const open = () => {
    socket = new WebSocket(liveUrl(options.baseUrl, lastSeq))
    socket.onopen = () => {
      delay = 500
      options.onStatus?.(true)
    }
    socket.onmessage = (message) => {
      const frame: unknown = JSON.parse(String(message.data))
      if (!isFrame(frame)) return
      if (frame.kind === "hello") {
        if (lastSeq === null || frame.head < lastSeq) lastSeq = frame.head
        options.onHello?.(frame.head)
        return
      }
      if (frame.kind === "activity") {
        options.onActivity?.(frame.activity, frame.working)
        return
      }
      if (frame.kind === "agents") {
        options.onAgents?.(frame.names)
        return
      }
      if (lastSeq !== null && frame.event.seq <= lastSeq) return
      lastSeq = frame.event.seq
      options.onEvent(frame.event)
    }
    socket.onclose = () => {
      options.onStatus?.(false)
      if (closed) return
      retry = setTimeout(open, delay)
      delay = Math.min(delay * 2, 5000)
    }
  }

  open()

  return {
    close() {
      closed = true
      clearTimeout(retry)
      const current = socket
      if (!current) return
      current.onmessage = null
      if (current.readyState === WebSocket.CONNECTING) current.onopen = () => current.close()
      else current.close()
    },
    get lastSeq() {
      return lastSeq
    },
  }
}
