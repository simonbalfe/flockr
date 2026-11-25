import { LiveFrame } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import type postgres from "postgres"
import { z } from "zod"
import { activityChannel, eventChannel } from "../../config"
import type { LiveHandlers, LiveListener, LiveSignal, LiveSignals } from "../live"

const HeadPayload = z.object({ board: z.string(), head: z.number().int() })

function readJson(raw: string): unknown {
  try {
    const value: unknown = JSON.parse(raw)
    return value
  } catch {
    return undefined
  }
}

function channelOf(signal: LiveSignal): { channel: string; payload: string } {
  switch (signal.kind) {
    case "head":
      return { channel: eventChannel, payload: JSON.stringify({ board: signal.board, head: signal.head }) }
    case "frame":
      return { channel: activityChannel, payload: JSON.stringify(signal.frame) }
    default: {
      const unknownSignal: never = signal
      throw new Error(`Unknown live signal ${JSON.stringify(unknownSignal)}`)
    }
  }
}

export const postgresSignals: LiveSignals = {
  async publish(tx, signal) {
    const { channel, payload } = channelOf(signal)
    await tx.execute(sql`select pg_notify(${channel}, ${payload})`)
  },
}

export function postgresListener(client: postgres.Sql): LiveListener {
  return {
    async listen({ onSignal, onResync }: LiveHandlers) {
      const heads = await client.listen(
        eventChannel,
        (payload) => {
          const head = HeadPayload.safeParse(readJson(payload))
          if (head.success) onSignal({ kind: "head", ...head.data })
          else onResync()
        },
        onResync,
      )
      const frames = await client.listen(activityChannel, (payload) => {
        const frame = LiveFrame.safeParse(readJson(payload))
        if (frame.success) onSignal({ kind: "frame", frame: frame.data })
      })
      return async () => {
        await heads.unlisten()
        await frames.unlisten()
      }
    },
  }
}
