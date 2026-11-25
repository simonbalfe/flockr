import { useSyncExternalStore } from "react"

export const feedModes = ["people", "everything"] as const
export type FeedMode = (typeof feedModes)[number]

export const feedModeLabels = { people: "People", everything: "Everything" } as const satisfies Record<FeedMode, string>

const storageKey = "flockr.feed-mode"
const listeners = new Set<() => void>()

function readStored(): FeedMode {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return feedModes.find((mode) => mode === stored) ?? "people"
  } catch {
    return "people"
  }
}

let current: FeedMode | null = null

function snapshot(): FeedMode {
  current ??= readStored()
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function persist(mode: FeedMode): void {
  try {
    window.localStorage.setItem(storageKey, mode)
  } catch {
    return
  }
}

export function setFeedMode(mode: FeedMode): void {
  current = mode
  persist(mode)
  for (const listener of listeners) listener()
}

export function useFeedMode(): FeedMode {
  return useSyncExternalStore(subscribe, snapshot)
}
