import type { LiveFrame } from "@flockr/contracts"
import type { Database } from "../db/client"
import { eventsSince, headSeq } from "../board/events"
import { canSee, isHostMember, stillLive, type Viewer } from "../board/visibility"
import type { LiveListener, LiveSignal } from "../platform"

export interface LiveSocket {
  send: (text: string) => void
  close: () => void
}

export interface SocketStore {
  list: () => Iterable<LiveSocket>
  seqOf: (socket: LiveSocket) => number | undefined
  viewerOf: (socket: LiveSocket) => Viewer | undefined
  start: (socket: LiveSocket, seq: number, viewer: Viewer) => void
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
  const seqs = new Map<LiveSocket, { seq: number; viewer: Viewer }>()
  return {
    list: () => seqs.keys(),
    seqOf: (socket) => seqs.get(socket)?.seq,
    viewerOf: (socket) => seqs.get(socket)?.viewer,
    start: (socket, seq, viewer) => void seqs.set(socket, { seq, viewer }),
    setSeq: (socket, seq) => {
      const current = seqs.get(socket)
      if (current) seqs.set(socket, { ...current, seq })
    },
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
        const viewer = sockets.viewerOf(socket)
        if (seq === undefined || viewer === undefined) return
        if (!(await stillLive(db, viewer))) {
          cut(socket)
          return
        }
        const events = await eventsSince(db, seq, pageSize, { kind: "live", viewer })
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

  const cut = (socket: LiveSocket) => {
    sockets.remove(socket)
    pumping.delete(socket)
    socket.close()
  }

  const pumpAll = () => {
    for (const socket of sockets.list()) void pump(socket).catch((error: unknown) => console.error("live pump failed", error))
  }

  const mayReceive = async (viewer: Viewer, frame: LiveFrame): Promise<boolean> => {
    switch (frame.kind) {
      case "activity":
        return canSee(db, viewer, frame.activity.channel)
      case "agents":
        return isHostMember(db, viewer)
      case "hello":
      case "event":
      case "resync":
        return true
      default: {
        const unknownFrame: never = frame
        throw new Error(`Unknown live frame ${JSON.stringify(unknownFrame)}`)
      }
    }
  }

  const broadcast = (frame: LiveFrame) => {
    for (const socket of sockets.list()) {
      const viewer = sockets.viewerOf(socket)
      if (!viewer) continue
      void mayReceive(viewer, frame)
        .then((allowed) => {
          if (allowed) send(socket, frame)
        })
        .catch((error: unknown) => console.error("live frame check failed", error))
    }
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

  const resync = () => {
    broadcast({ kind: "resync" })
    pumpAll()
  }

  const listening = listener.listen({ onSignal, onResync: resync })

  return {
    ready: listening.then(() => undefined),
    async attach(socket: LiveSocket, since: number | null, viewer: Viewer): Promise<void> {
      const head = await headSeq(db)
      sockets.start(socket, since === null ? head : Math.min(since, head), viewer)
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
