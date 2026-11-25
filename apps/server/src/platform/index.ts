import type { LiveSignals } from "./live"
import { postgresSignals } from "./postgres/live"

export { LiveSignal, pushListener, type LiveHandlers, type LiveListener, type LiveSignals } from "./live"
export { postgresListener } from "./postgres/live"
export { timerScheduler } from "./bun/scheduler"
export type { Scheduler, Tick } from "./scheduler"

let active: LiveSignals = postgresSignals

export const liveSignals: LiveSignals = {
  publish: (tx, signal) => active.publish(tx, signal),
}

export function useLiveSignals(signals: LiveSignals): void {
  active = signals
}
