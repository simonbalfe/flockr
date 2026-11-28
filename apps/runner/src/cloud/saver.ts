import type { SessionFence } from "@flockr/contracts/sessions"
import type { SessionsPort } from "../board"
import type { SessionSaver } from "../harness/types"
import { needsOpen, openSession } from "../session-fence"

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200)

const base64 = (data: Uint8Array) => {
  let text = ""
  for (const byte of data) text += String.fromCharCode(byte)
  return btoa(text)
}

interface Open {
  fence: SessionFence
  next: number
}

export function directSaver(options: { board: SessionsPort; log: (line: string) => void }): SessionSaver {
  const { board, log } = options
  const open = new Map<string, Open>()
  const lost = new Set<string>()
  let chain: Promise<unknown> = Promise.resolve()
  const queued = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => undefined)
    return next
  }

  return {
    restore: (place) =>
      queued(async () => {
        const opened = await openSession(board, place)
        open.set(place.session, { fence: opened.fence, next: opened.saved + 1 })
        lost.delete(place.session)
        const chunks: Uint8Array[] = []
        for (const turn of opened.turns) chunks.push(await board.chunk(place.session, turn))
        return chunks
      }),
    save: (place, chunk) =>
      queued(async () => {
        if (lost.has(place.session)) return false
        try {
          const reopen = async (): Promise<Open> => {
            const opened = await openSession(board, place)
            const fresh = { fence: opened.fence, next: opened.saved + 1 }
            open.set(place.session, fresh)
            return fresh
          }
          const kept = open.get(place.session) ?? null
          let current = kept && !needsOpen(kept.fence, place) ? kept : await reopen()
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await board.save(place.session, { fence: current.fence, turn: current.next, data: base64(chunk.data) })
            switch (result.kind) {
              case "saved":
                open.set(place.session, { ...current, next: current.next + 1 })
                return true
              case "stale":
                lost.add(place.session)
                log(`session ${place.session}: not saved, this worker no longer owns it: ${result.reason}`)
                return false
              case "conflict":
                if (attempt > 0) {
                  log(`session ${place.session}: not saved this turn: ${result.reason}`)
                  return false
                }
                current = await reopen()
                break
              default: {
                const never: never = result
                throw new Error(`Unknown save result ${JSON.stringify(never)}`)
              }
            }
          }
          return false
        } catch (error) {
          log(`session ${place.session}: not saved this turn, the next turn sends these steps: ${short(error)}`)
          return false
        }
      }),
    cursor: () => null,
    mark: () => undefined,
    latest: (thread) => board.latest(thread),
  }
}
