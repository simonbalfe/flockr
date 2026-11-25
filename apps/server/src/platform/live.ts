import type { LiveFrame } from "@flockr/contracts"
import type { Executor } from "../db/client"

export type LiveSignal = { kind: "head"; board: string; head: number } | { kind: "frame"; frame: LiveFrame }

export interface LiveSignals {
  publish: (tx: Executor, signal: LiveSignal) => Promise<void>
}

export interface LiveHandlers {
  onSignal: (signal: LiveSignal) => void
  onResync: () => void
}

export interface LiveListener {
  listen: (handlers: LiveHandlers) => Promise<() => Promise<void>>
}
