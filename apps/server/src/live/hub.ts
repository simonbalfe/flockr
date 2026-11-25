import type { LiveFrame } from "@flockr/contracts"
import type { Database } from "../db/client"
import { eventsSince, headSeq } from "../board/events"
import type { LiveListener, LiveSignal } from "../platform"

export interface LiveSocket {
  send: (text: string) => void
}

interface Cursor {
  seq: number
  pumping: boolean
  dirty: boolean
}

const pageSize = 500

export function parseSince(url: URL): number | null {
  const raw = url.searchParams.get("since")
  if (raw === null || raw === "") return null
  const since = Number(raw)
  return Number.isInteger(since) && since >= 0 ? since : null
}

export function createHub(db: Database, listener: LiveListener) {
  const sockets = new Map<LiveSocket, Cursor>()

  const send = (socket: LiveSocket, frame: LiveFrame) => socket.send(JSON.stringify(frame))

  const pump = async (socket: LiveSocket): Promise<void> => {
    const cursor = sockets.get(socket)
    if (!cursor) return
    if (cursor.pumping) {
      cursor.dirty = true
      return
    }
    cursor.pumping = true
    try {
      for (;;) {
        cursor.dirty = false
        const events = await eventsSince(db, cursor.seq, pageSize)
        if (!sockets.has(socket)) return
        for (const event of events) send(socket, { kind: "event", event })
        const last = events[events.length - 1]
        if (last) cursor.seq = last.seq
        if (events.length < pageSize && !cursor.dirty) return
      }
    } finally {
      cursor.pumping = false
    }
  }

  const pumpAll = () => {
    for (const socket of sockets.keys()) void pump(socket).catch((error: unknown) => console.error("live pump failed", error))
  }

  const broadcast = (frame: LiveFrame) => {
    for (const socket of sockets.keys()) send(socket, frame)
  }

  const onSignal = (signal: LiveSignal) => {
    switch (signal.kind) {
      case "head":
        pumpAll()
        return
      case "frame":
        broadcast(signal.frame)
        return
      default: {
        const unknownSignal: never = signal
        throw new Error(`Unknown live signal ${JSON.stringify(unknownSignal)}`)
      }
    }
  }

  const listening = listener.listen({ onSignal, onResync: pumpAll })

  return {
    ready: listening.then(() => undefined),
    async attach(socket: LiveSocket, since: number | null): Promise<void> {
      const head = await headSeq(db)
      sockets.set(socket, { seq: since === null ? head : Math.min(since, head), pumping: false, dirty: false })
      send(socket, { kind: "hello", head })
      await pump(socket)
    },
    detach(socket: LiveSocket): void {
      sockets.delete(socket)
    },
    get size() {
      return sockets.size
    },
    async close(): Promise<void> {
      sockets.clear()
      const stop = await listening
      await stop()
    },
  }
}

export type Hub = ReturnType<typeof createHub>
