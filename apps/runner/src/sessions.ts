import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SessionFence } from "@flockr/contracts/sessions"
import { z } from "zod"
import type { SessionsPort } from "./board"
import type { SessionPlace, SessionSaver } from "./harness/types"
import { needsOpen, openSession } from "./session-fence"

const OutboxEntry = z.object({ id: z.string(), turn: z.number().int().min(1), fence: SessionFence })

const LocalSession = z.object({
  fence: SessionFence.nullable(),
  next: z.number().int().min(1),
  cursor: z.string().nullable(),
  lost: z.boolean(),
  outbox: z.array(OutboxEntry),
})
type LocalSession = z.infer<typeof LocalSession>

const fresh = (): LocalSession => ({ fence: null, next: 1, cursor: null, lost: false, outbox: [] })

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200)

export interface SaverOptions {
  dir: string
  board: SessionsPort
  log: (line: string) => void
}

export function sessionSaver(options: SaverOptions): SessionSaver & { flush: (place: SessionPlace) => Promise<void> } {
  const { board, log } = options
  const queues = new Map<string, Promise<unknown>>()

  const folder = (session: string) => path.join(options.dir, session)
  const stateFile = (session: string) => path.join(folder(session), "state.json")
  const dataFile = (session: string, id: string) => path.join(folder(session), "outbox", `${id}.chunk`)

  function read(session: string): LocalSession {
    try {
      const parsed = LocalSession.safeParse(JSON.parse(readFileSync(stateFile(session), "utf8")))
      return parsed.success ? parsed.data : fresh()
    } catch {
      return fresh()
    }
  }

  function write(session: string, state: LocalSession): void {
    mkdirSync(folder(session), { recursive: true })
    const temp = `${stateFile(session)}.tmp`
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(temp, stateFile(session))
  }

  function queued<T>(session: string, work: () => Promise<T>): Promise<T> {
    const next = (queues.get(session) ?? Promise.resolve()).then(work, work)
    queues.set(
      session,
      next.catch(() => undefined),
    )
    return next
  }

  async function open(place: SessionPlace, state: LocalSession): Promise<{ state: LocalSession; turns: number[] }> {
    const { fence, saved, turns } = await openSession(board, place)
    let next = saved + 1
    const outbox = state.outbox.map((entry) => ({ ...entry, turn: next++, fence }))
    return { state: { ...state, fence, next, lost: false, outbox }, turns }
  }

  function drop(session: string, state: LocalSession, reason: string): LocalSession {
    log(`session ${session}: not saved, ${reason}`)
    for (const entry of state.outbox) rmSync(dataFile(session, entry.id), { force: true })
    const next = { ...state, lost: true, outbox: [] }
    write(session, next)
    return next
  }

  async function deliver(place: SessionPlace, start: LocalSession): Promise<void> {
    let state = start
    let reopened = false
    while (state.outbox.length) {
      const [entry] = state.outbox
      if (!entry) return
      const data = Buffer.from(readFileSync(dataFile(place.session, entry.id))).toString("base64")
      const result = await board.save(place.session, { fence: entry.fence, turn: entry.turn, data })
      switch (result.kind) {
        case "saved":
          rmSync(dataFile(place.session, entry.id), { force: true })
          state = { ...state, outbox: state.outbox.slice(1) }
          write(place.session, state)
          break
        case "stale":
          drop(place.session, state, `this worker no longer owns it: ${result.reason}`)
          return
        case "conflict":
          if (reopened) {
            drop(place.session, state, result.reason)
            return
          }
          reopened = true
          state = (await open(place, state)).state
          write(place.session, state)
          break
        default: {
          const never: never = result
          throw new Error(`Unknown save result ${JSON.stringify(never)}`)
        }
      }
    }
  }

  return {
    restore: (place) =>
      queued(place.session, async () => {
        const local = read(place.session)
        for (const entry of local.outbox) rmSync(dataFile(place.session, entry.id), { force: true })
        const { state, turns } = await open(place, { ...fresh(), outbox: [] })
        const chunks: Uint8Array[] = []
        for (const turn of turns) chunks.push(await board.chunk(place.session, turn))
        write(place.session, state)
        return chunks
      }),
    save: (place, chunk) =>
      queued(place.session, async () => {
        let state = read(place.session)
        if (state.lost && !(place.claim && needsOpen(state.fence, place))) return true
        try {
          if (needsOpen(state.fence, place)) state = (await open(place, state)).state
        } catch (error) {
          log(`session ${place.session}: could not open it on the board, the next turn sends these steps: ${short(error)}`)
          return false
        }
        const fence = state.fence
        if (!fence) return false
        const entry = { id: randomUUID(), turn: state.next, fence }
        mkdirSync(path.dirname(dataFile(place.session, entry.id)), { recursive: true })
        writeFileSync(dataFile(place.session, entry.id), chunk.data)
        state = { ...state, next: state.next + 1, cursor: chunk.cursor, outbox: [...state.outbox, entry] }
        write(place.session, state)
        await deliver(place, state).catch((error: unknown) => log(`session ${place.session}: kept ${state.outbox.length} chunk(s) to send later: ${short(error)}`))
        return true
      }),
    flush: (place) => queued(place.session, () => deliver(place, read(place.session))),
    cursor: (session) => read(session).cursor,
    mark: (session, cursor) => write(session, { ...read(session), cursor }),
    latest: (thread) => board.latest(thread),
  }
}
