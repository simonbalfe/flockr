import { LiveFrame } from "@flockr/contracts"
import { z } from "zod"
import type { Executor } from "../db/client"

export const LiveSignal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("head"), board: z.string(), head: z.number().int() }),
  z.object({ kind: z.literal("frame"), frame: LiveFrame }),
])

export type LiveSignal = z.infer<typeof LiveSignal>

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

export function pushListener() {
  let handlers: LiveHandlers | undefined
  const listener: LiveListener = {
    async listen(next) {
      handlers = next
      return async () => {
        handlers = undefined
      }
    },
  }
  return { listener, push: (signal: LiveSignal) => handlers?.onSignal(signal) }
}
