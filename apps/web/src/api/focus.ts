import type { Agent, Focus, FocusRun, Plan, PlanDetail, PlanState, RunStep } from "@flockr/client"
import {
  closePlanMutation,
  createPlanMutation,
  getFocusOptions,
  getPlanOptions,
  listPlansOptions,
  reopenPlanMutation,
  setTaskPlanMutation,
  updatePlanMutation,
} from "@flockr/client/react-query"
import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { toast } from "sonner"
import { needItems, type NeedItem } from "@/lib/focus"
import { errorText, useBoardMutation } from "./hooks"

export type { Focus, FocusRun, NeedItem, Plan, PlanDetail, RunStep }
export { threadOf } from "@/lib/focus"

export const focusQueries = {
  focus: () => getFocusOptions(),
  plans: (filter: { channel?: string; state?: PlanState } = {}) => listPlansOptions({ query: filter }),
  plan: (id: number) => getPlanOptions({ path: { id } }),
}

export const useFocus = () => useQuery(focusQueries.focus())
export const usePlans = (filter: { channel?: string; state?: PlanState } = {}) => useQuery(focusQueries.plans(filter))
export const usePlan = (id: number, enabled = true) => useQuery({ ...focusQueries.plan(id), enabled })

const onPlan = (id: number) => ({ path: { id } })

export const useCreatePlan = () =>
  useBoardMutation(createPlanMutation(), (a: { channel: string; title: string; goal?: string | null; key?: string }) => ({
    body: { channel: a.channel, title: a.title, goal: a.goal ?? null, key: a.key },
  }))
export const useUpdatePlan = () =>
  useBoardMutation(updatePlanMutation(), (a: { id: number; title?: string; goal?: string | null }) => ({ ...onPlan(a.id), body: { title: a.title, goal: a.goal } }))
export const useClosePlan = () => useBoardMutation(closePlanMutation(), onPlan)
export const useReopenPlan = () => useBoardMutation(reopenPlanMutation(), onPlan)
export const useSetTaskPlan = () =>
  useBoardMutation(setTaskPlanMutation(), (a: { task: number; plan: number | null }) => ({ path: { id: a.task }, body: { plan: a.plan } }))

export const undoSeconds = 5

const timers = new Map<string, { timer: number; run: () => Promise<unknown> }>()
const listeners = new Set<() => void>()
let hidden: ReadonlySet<string> = new Set()

function setHidden(next: Set<string>) {
  hidden = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function commit(key: string) {
  const entry = timers.get(key)
  if (!entry) return
  window.clearTimeout(entry.timer)
  timers.delete(key)
  entry
    .run()
    .catch((error: unknown) => toast.error(errorText(error)))
    .finally(() => {
      const next = new Set(hidden)
      next.delete(key)
      setHidden(next)
    })
}

function undo(key: string) {
  const entry = timers.get(key)
  if (!entry) return
  window.clearTimeout(entry.timer)
  timers.delete(key)
  const next = new Set(hidden)
  next.delete(key)
  setHidden(next)
}

export function hideWithUndo(a: { key: string; done: string; run: () => Promise<unknown> }) {
  if (timers.has(a.key)) return
  setHidden(new Set(hidden).add(a.key))
  timers.set(a.key, { timer: window.setTimeout(() => commit(a.key), undoSeconds * 1000), run: a.run })
  toast(a.done, { duration: undoSeconds * 1000, action: { label: "Undo", onClick: () => undo(a.key) } })
}

window.addEventListener("pagehide", () => {
  for (const key of [...timers.keys()]) commit(key)
})

export function useHiddenCards(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => hidden)
}

export function useNeedsYou(): { items: NeedItem[]; loaded: boolean } {
  const focus = useFocus()
  const gone = useHiddenCards()
  if (!focus.data) return { items: [], loaded: false }
  return { items: needItems(focus.data.needsYou).filter((item) => !gone.has(item.key)), loaded: true }
}

export function leadOf(agents: Agent[]): Agent | null {
  return agents.find((agent) => agent.name === "lead") ?? null
}
