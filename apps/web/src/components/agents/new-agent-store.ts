import { useSyncExternalStore } from "react"

let open = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  open = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const openNewAgent = () => set(true)
export const setNewAgentOpen = (next: boolean) => set(next)
export const useNewAgentOpen = () => useSyncExternalStore(subscribe, () => open)
