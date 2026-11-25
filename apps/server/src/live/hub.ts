import { LiveFrame } from "@flockr/contracts"
import { activityChannel, eventChannel } from "../config"
import type { Connection } from "../db/client"
import { eventsSince, headSeq } from "../board/events"

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

export function createHub(connection: Connection) {
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
        const events = await eventsSince(connection.db, cursor.seq, pageSize)
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

  const broadcast = (payload: string) => {
    const parsed = LiveFrame.safeParse(JSON.parse(payload))
    if (!parsed.success) return
    for (const socket of sockets.keys()) send(socket, parsed.data)
  }

  const listening = connection.sql.listen(eventChannel, pumpAll, pumpAll)
  const hearingActivity = connection.sql.listen(activityChannel, broadcast)

  return {
    ready: Promise.all([listening, hearingActivity]).then(() => undefined),
    async attach(socket: LiveSocket, since: number | null): Promise<void> {
      const head = await headSeq(connection.db)
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
      await (await listening).unlisten()
      await (await hearingActivity).unlisten()
    },
  }
}

export type Hub = ReturnType<typeof createHub>
