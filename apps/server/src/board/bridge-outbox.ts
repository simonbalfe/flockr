import { bridgedEventTypes } from "@flockr/contracts"
import { inArray } from "drizzle-orm"
import type { Tx } from "../db/client"
import { bridgeChannels } from "../db/schema"
import { enqueueJob } from "./jobs"
import type { WrittenEvent } from "./watchers"

const bridged: ReadonlySet<string> = new Set(bridgedEventTypes)

export async function enqueueBridgeJobs(tx: Tx, written: WrittenEvent[]): Promise<number> {
  const candidates = written.filter((e) => e.channel !== null && bridged.has(e.type))
  if (!candidates.length) return 0
  const links = await tx
    .select({ bridge: bridgeChannels.bridge, channel: bridgeChannels.channel })
    .from(bridgeChannels)
    .where(inArray(bridgeChannels.channel, [...new Set(candidates.flatMap((e) => e.channel ?? []))]))
  let queued = 0
  for (const event of candidates) {
    for (const link of links) {
      if (link.channel !== event.channel) continue
      if (await enqueueJob(tx, { kind: "bridge", key: `bridge:${link.bridge}:${event.seq}`, routineId: null, payload: { bridge: link.bridge, seq: event.seq } })) queued++
    }
  }
  return queued
}
