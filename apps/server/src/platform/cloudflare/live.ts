import { AsyncLocalStorage } from "node:async_hooks"
import type { LiveSignal, LiveSignals } from "../live"

const outbox = new AsyncLocalStorage<LiveSignal[]>()

export const cloudflareSignals: LiveSignals = {
  async publish(_tx, signal) {
    const pending = outbox.getStore()
    if (pending) pending.push(signal)
    else console.warn(`live signal ${signal.kind} published outside a request; dropped`)
  },
}

export async function collectSignals<T>(run: () => Promise<T>): Promise<{ result: T; signals: LiveSignal[] }> {
  const signals: LiveSignal[] = []
  const result = await outbox.run(signals, run)
  return { result, signals }
}
