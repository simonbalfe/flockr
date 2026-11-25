import { activityEventTypes, applyActivityUpdates, type BoardEvent } from "@flockr/client"
import { getThreadOptions } from "@flockr/client/react-query"
import type { QueryClient } from "@tanstack/react-query"

type Schemas = typeof import("@flockr/client/activity")

let schemas: Schemas | null = null
const loading = import("@flockr/client/activity").then((loaded) => {
  schemas = loaded
  return loaded
})

export const activitySchemasReady = loading.then(() => undefined)

export function patchActivity(client: QueryClient, event: BoardEvent): boolean {
  if (event.type !== activityEventTypes.updated || !event.threadId || !event.messageId || !schemas) return false
  const data = schemas.ActivityUpdatedData.safeParse(event.data)
  if (!data.success) return false
  const key = getThreadOptions({ path: { id: event.threadId } }).queryKey
  const thread = client.getQueryData(key)
  if (!thread) return true
  const entry = thread.entries.find((e) => e.kind === "activity" && e.id === event.messageId)
  if (!entry || entry.kind !== "activity") return false
  if (entry.revision >= data.data.revision) return true
  if (entry.revision !== data.data.revision - 1) return false
  const next = applyActivityUpdates({ ...entry, key: null }, data.data.updates, data.data.at)
  if (!next.ok) return false
  const { key: _key, ...state } = next.state
  client.setQueryData(key, { ...thread, entries: thread.entries.map((e) => (e.kind === "activity" && e.id === entry.id ? { ...entry, ...state } : e)) })
  return true
}
