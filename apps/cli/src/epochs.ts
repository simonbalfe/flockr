import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export const defaultClaimsFile = path.join(process.env.FLOCKR_HOME ?? path.join(homedir(), ".flockr"), "claims.json")

type Claims = Record<string, number>

function load(file: string): Claims {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
  } catch {
    return {}
  }
}

function save(file: string, claims: Claims): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(claims, null, 2)}\n`)
}

export interface EpochStore {
  get: (id: number) => number | undefined
  set: (id: number, epoch: number) => void
  clear: (id: number) => void
}

export function epochStore(options: { file: string; url: string; member: string }): EpochStore {
  const { file, url, member } = options
  const key = (id: number) => `${url}|${member}|${id}`
  return {
    get: (id) => load(file)[key(id)],
    set(id, epoch) {
      save(file, { ...load(file), [key(id)]: epoch })
    },
    clear(id) {
      const claims = load(file)
      delete claims[key(id)]
      save(file, claims)
    },
  }
}
