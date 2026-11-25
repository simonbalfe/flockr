import { useSyncExternalStore } from "react"

const tickMs = 15_000
let snapshot = Date.now()
const listeners = new Set<() => void>()
let timer: number | undefined

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    snapshot = Date.now()
    timer = window.setInterval(() => {
      snapshot = Date.now()
      for (const l of listeners) l()
    }, tickMs)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.clearInterval(timer)
  }
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => snapshot)
}
