import { activityEventTypes, applyActivityUpdates, type ActivityEntry, type BoardEvent } from "@flockr/client"
import { getThreadOptions, listAgentActivityOptions } from "@flockr/client/react-query"
import type { QueryClient } from "@tanstack/react-query"

type Schemas = typeof import("@flockr/client/activity")
type Updated = { revision: number; at: string; updates: Parameters<typeof applyActivityUpdates>[1] }
type Patched = { kind: "same" } | { kind: "next"; entry: ActivityEntry } | { kind: "missed" }

let schemas: Schemas | null = null
const loading = import("@flockr/client/activity").then((loaded) => {
  schemas = loaded
  return loaded
})

export const activitySchemasReady = loading.then(() => undefined)

export const agentActivityQuery = (name: string) => listAgentActivityOptions({ path: { name } })

function patchEntry(entry: ActivityEntry, data: Updated): Patched {
  if (entry.revision >= data.revision) return { kind: "same" }
  if (entry.revision !== data.revision - 1) return { kind: "missed" }
  const next = applyActivityUpdates({ ...entry, key: null }, data.updates, data.at)
  if (!next.ok) return { kind: "missed" }
  const { key: _key, ...state } = next.state
  return { kind: "next", entry: { ...entry, ...state } }
}

function patchThread(client: QueryClient, threadId: string, entryId: string, data: Updated): boolean {
  const key = getThreadOptions({ path: { id: threadId } }).queryKey
  const thread = client.getQueryData(key)
  if (!thread) return true
  const entry = thread.entries.find((e) => e.kind === "activity" && e.id === entryId)
  if (!entry || entry.kind !== "activity") return false
  const patched = patchEntry(entry, data)
  if (patched.kind === "next") client.setQueryData(key, { ...thread, entries: thread.entries.map((e) => (e.kind === "activity" && e.id === entryId ? patched.entry : e)) })
  return patched.kind !== "missed"
}

function patchAgentRuns(client: QueryClient, member: string, entryId: string, data: Updated): boolean {
  const key = agentActivityQuery(member).queryKey
  const runs = client.getQueryData(key)
  const entry = runs?.find((e) => e.id === entryId)
  if (!runs || !entry) return true
  const patched = patchEntry(entry, data)
  if (patched.kind === "next") client.setQueryData(key, runs.map((e) => (e.id === entryId ? patched.entry : e)))
  return patched.kind !== "missed"
}

export function patchActivity(client: QueryClient, event: BoardEvent): boolean {
  if (event.type !== activityEventTypes.updated || !event.threadId || !event.messageId || !schemas) return false
  const data = schemas.ActivityUpdatedData.safeParse(event.data)
  if (!data.success) return false
  const thread = patchThread(client, event.threadId, event.messageId, data.data)
  const runs = patchAgentRuns(client, event.actor, event.messageId, data.data)
  return thread && runs
}
