import { activityLimits, type ActivityUpdate } from "@flockr/client"

export const activityFlushMs = 500

export interface ActivitySink {
  push: (updates: ActivityUpdate[]) => void
  flush: () => Promise<void>
}

export interface ActivitySinkDeps {
  entry: Promise<string | null>
  send: (entryId: string, updates: ActivityUpdate[]) => Promise<void>
  after: (ms: number, run: () => void) => () => void
  log: (line: string) => void
}

export function activitySink(deps: ActivitySinkDeps): ActivitySink {
  let buffer: ActivityUpdate[] = []
  let cancel: (() => void) | null = null
  let sending: Promise<void> = Promise.resolve()

  const sendAll = async (batch: ActivityUpdate[]) => {
    const entryId = await deps.entry
    if (!entryId) return
    for (let start = 0; start < batch.length; start += activityLimits.updates) {
      try {
        await deps.send(entryId, batch.slice(start, start + activityLimits.updates))
      } catch (error) {
        deps.log(`could not update activity entry ${entryId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const flush = (): Promise<void> => {
    cancel?.()
    cancel = null
    const batch = buffer
    buffer = []
    if (batch.length) sending = sending.then(() => sendAll(batch))
    return sending
  }

  return {
    push(updates) {
      if (!updates.length) return
      buffer.push(...updates)
      cancel ??= deps.after(activityFlushMs, () => void flush())
    },
    flush,
  }
}
