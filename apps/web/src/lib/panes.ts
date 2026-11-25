import { useSyncExternalStore } from "react"

export const paneLimits = {
  sidebar: { min: 180, max: 400, initial: 232 },
  panel: { min: 300, max: 760, initial: 380 },
} as const

export type PaneName = keyof typeof paneLimits

export interface Panes {
  sidebarOpen: boolean
  sidebar: number
  panel: number
}

const storageKey = "flockr.panes"
const listeners = new Set<() => void>()
const initial: Panes = { sidebarOpen: true, sidebar: paneLimits.sidebar.initial, panel: paneLimits.panel.initial }

export const clampPane = (name: PaneName, width: number): number => Math.round(Math.min(paneLimits[name].max, Math.max(paneLimits[name].min, width)))

function readStored(): Panes {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null")
    if (typeof raw !== "object" || raw === null) return initial
    const open = "sidebarOpen" in raw && typeof raw.sidebarOpen === "boolean" ? raw.sidebarOpen : initial.sidebarOpen
    const sidebar = "sidebar" in raw && typeof raw.sidebar === "number" ? clampPane("sidebar", raw.sidebar) : initial.sidebar
    const panel = "panel" in raw && typeof raw.panel === "number" ? clampPane("panel", raw.panel) : initial.panel
    return { sidebarOpen: open, sidebar, panel }
  } catch {
    return initial
  }
}

let current: Panes | null = null

function snapshot(): Panes {
  current ??= readStored()
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function persist(panes: Panes): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(panes))
  } catch {
    return
  }
}

export function updatePanes(change: Partial<Panes>): void {
  current = { ...snapshot(), ...change }
  persist(current)
  for (const listener of listeners) listener()
}

export const resizePane = (name: PaneName, width: number): void => updatePanes({ [name]: clampPane(name, width) })
export const resetPane = (name: PaneName): void => updatePanes({ [name]: paneLimits[name].initial })

export function usePanes(): Panes {
  return useSyncExternalStore(subscribe, snapshot)
}
