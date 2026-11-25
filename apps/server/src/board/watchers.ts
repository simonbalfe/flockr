import { watchableEventTypes, type JobCause } from "@flockr/contracts"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { Tx } from "../db/client"
import { routines } from "../db/schema"
import { enqueueJob } from "./jobs"

export interface WrittenEvent {
  seq: number
  type: string
  channel: string | null
  data: Record<string, unknown>
}

const watchable: ReadonlySet<string> = new Set(watchableEventTypes)

export const causedByRoutine = (data: Record<string, unknown>) => data.routine !== undefined

export async function enqueueWatchers(tx: Tx, written: WrittenEvent[]): Promise<number> {
  const candidates = written.filter((e) => e.channel !== null && watchable.has(e.type) && !causedByRoutine(e.data))
  if (!candidates.length) return 0
  const watching = await tx
    .select({ id: routines.id, channel: routines.channel, eventType: routines.eventType })
    .from(routines)
    .where(
      and(
        eq(routines.enabled, true),
        isNull(routines.deletedAt),
        eq(routines.triggerKind, "event"),
        inArray(routines.channel, [...new Set(candidates.flatMap((e) => e.channel ?? []))]),
        inArray(routines.eventType, [...new Set(candidates.map((e) => e.type))]),
      ),
    )
  let queued = 0
  for (const event of candidates) {
    for (const routine of watching) {
      if (routine.channel !== event.channel || routine.eventType !== event.type) continue
      const cause: JobCause = { kind: "event", seq: event.seq, type: event.type }
      if (await enqueueJob(tx, { kind: "routine", key: `routine:${routine.id}:event:${event.seq}`, routineId: routine.id, payload: { cause } })) queued++
    }
  }
  return queued
}
