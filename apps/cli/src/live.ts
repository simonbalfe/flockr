import { connectLive, type BoardEvent } from "@flockr/client"
import { envKey } from "./config"

export interface EventQueue {
  next: (match: (event: BoardEvent) => boolean, deadline: number) => Promise<BoardEvent | null>
  close: () => void
}

export function openQueue(baseUrl: string): Promise<EventQueue> {
  return new Promise((resolve) => {
    const buffered: BoardEvent[] = []
    let wake: (() => void) | null = null
    const connection = connectLive({
      baseUrl,
      key: envKey,
      onHello: () => resolve(queue),
      onEvent: (event) => {
        buffered.push(event)
        wake?.()
      },
    })
    const queue: EventQueue = {
      async next(match, deadline) {
        for (;;) {
          const index = buffered.findIndex(match)
          if (index >= 0) return buffered.splice(0, index + 1).at(-1) ?? null
          buffered.length = 0
          const left = deadline - Date.now()
          if (left <= 0) return null
          await new Promise<void>((done) => {
            const timer = setTimeout(done, Math.min(left, 2_147_000_000))
            wake = () => {
              clearTimeout(timer)
              wake = null
              done()
            }
          })
        }
      },
      close: () => connection.close(),
    }
  })
}
