import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

export interface JsonStore<T> {
  get: () => T
  set: (value: T) => void
}

export function jsonStore<S extends z.ZodType>(file: string, schema: S, empty: z.infer<S>): JsonStore<z.infer<S>> {
  let cached: z.infer<S> | undefined
  const read = (): z.infer<S> => {
    try {
      const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")))
      return parsed.success ? parsed.data : empty
    } catch {
      return empty
    }
  }
  return {
    get() {
      cached ??= read()
      return cached
    },
    set(value) {
      cached = value
      mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
      renameSync(temp, file)
    },
  }
}

export const RunnerState = z.object({ lastSeq: z.number().int().nullable() })
export type RunnerState = z.infer<typeof RunnerState>
export const emptyState: RunnerState = { lastSeq: null }

export const SessionMap = z.record(z.string(), z.object({ harness: z.string(), id: z.string() }))
export type SessionMap = z.infer<typeof SessionMap>

const keySeparator = ":"

export const sessionKey = (member: string, thread: string) => `${member}${keySeparator}${thread}`

export function keySessions(sessions: SessionMap, member: string): SessionMap {
  return Object.fromEntries(Object.entries(sessions).map(([key, value]) => [key.includes(keySeparator) ? key : sessionKey(member, key), value]))
}
