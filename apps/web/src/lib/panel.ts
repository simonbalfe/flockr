import { useNavigate, useSearch } from "@tanstack/react-router"

export interface PanelSearch {
  thread?: string
  task?: number
  agent?: string
  label?: string
}

export function parsePanelSearch(raw: Record<string, unknown>): PanelSearch {
  const task = Number(raw.task)
  const thread = typeof raw.thread === "string" || typeof raw.thread === "number" ? String(raw.thread) : undefined
  return {
    thread: thread || undefined,
    task: Number.isInteger(task) && task > 0 ? task : undefined,
    agent: typeof raw.agent === "string" && raw.agent ? raw.agent : undefined,
    label: typeof raw.label === "string" && raw.label ? raw.label : undefined,
  }
}

export function usePanel() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as PanelSearch
  const go = (next: PanelSearch) => void navigate({ to: ".", search: (prev) => ({ ...prev, thread: undefined, task: undefined, agent: undefined, ...next }) })
  return {
    search,
    openTask: (id: number) => go({ task: id }),
    openThread: (id: string) => go({ thread: id }),
    openById: (id: string) => (/^\d+$/.test(id) ? go({ task: Number(id) }) : go({ thread: id })),
    openAgent: (name: string) => go({ agent: name }),
    close: () => go({}),
    filterLabel: (label: string | undefined) => void navigate({ to: ".", search: (prev) => ({ ...prev, label }) }),
  }
}
