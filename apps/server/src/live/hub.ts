import type { LiveFrame } from "@flockr/contracts"
import type { Database } from "../db/client"
import { eventsSince, headSeq } from "../board/events"
import type { LiveListener, LiveSignal } from "../platform"

export interface LiveSocket {
  send: (text: string) => void
}

export interface SocketStore {
  list: () => Iterable<LiveSocket>
  seqOf: (socket: LiveSocket) => number | undefined
  setSeq: (socket: LiveSocket, seq: number) => void
  remove: (socket: LiveSocket) => void
  clear: () => void
  size: () => number
}

interface Pumping {
  running: boolean
  dirty: boolean
}

export function memorySockets(): SocketStore {
  const seqs = new Map<LiveSocket, number>()
  return {
    list: () => seqs.keys(),
    seqOf: (socket) => seqs.get(socket),
    setSeq: (socket, seq) => void seqs.set(socket, seq),
    remove: (socket) => void seqs.delete(socket),
    clear: () => seqs.clear(),
    size: () => seqs.size,
  }
}

const pageSize = 500

export function parseSince(url: URL): number | null {
  const raw = url.searchParams.get("since")
  if (raw === null || raw === "") return null
  const since = Number(raw)
  return Number.isInteger(since) && since >= 0 ? since : null
}

export function createHub(db: Database, listener: LiveListener, sockets: SocketStore = memorySockets()) {
  const pumping = new Map<LiveSocket, Pumping>()

  const send = (socket: LiveSocket, frame: LiveFrame) => socket.send(JSON.stringify(frame))

  const pump = async (socket: LiveSocket): Promise<void> => {
    if (sockets.seqOf(socket) === undefined) return
    const state = pumping.get(socket) ?? { running: false, dirty: false }
    pumping.set(socket, state)
    if (state.running) {
      state.dirty = true
      return
    }
    state.running = true
    try {
      for (;;) {
        state.dirty = false
        const seq = sockets.seqOf(socket)
        if (seq === undefined) return
        const events = await eventsSince(db, seq, pageSize)
        if (sockets.seqOf(socket) === undefined) return
        for (const event of events) send(socket, { kind: "event", event })
        const last = events[events.length - 1]
        if (last) sockets.setSeq(socket, last.seq)
        if (events.length < pageSize && !state.dirty) return
      }
    } finally {
      state.running = false
    }
  }

  const pumpAll = () => {
    for (const socket of sockets.list()) void pump(socket).catch((error: unknown) => console.error("live pump failed", error))
  }

  const broadcast = (frame: LiveFrame) => {
    for (const socket of sockets.list()) send(socket, frame)
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
      sockets.setSeq(socket, since === null ? head : Math.min(since, head))
      send(socket, { kind: "hello", head })
      await pump(socket)
    },
    detach(socket: LiveSocket): void {
      sockets.remove(socket)
      pumping.delete(socket)
    },
    get size() {
      return sockets.size()
    },
    async close(): Promise<void> {
      sockets.clear()
      pumping.clear()
      const stop = await listening
      await stop()
    },
  }
}

export type Hub = ReturnType<typeof createHub>
