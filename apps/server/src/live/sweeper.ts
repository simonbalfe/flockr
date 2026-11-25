import { sweepExpiredAreas } from "../board/areas"
import { sweepExpiredClaims } from "../board/claims"
import { machineLimits } from "@flockr/contracts"
import type { Database } from "../db/client"
import { sweepMachines } from "../board/machines"

export interface SweepResult {
  leases: number[]
  areas: number[]
  machines: string[]
}

function logged<T>(work: Promise<T[]>, label: string, describe: (items: T[]) => string): Promise<T[]> {
  return work
    .then((items) => {
      if (items.length) console.log(describe(items))
      return items
    })
    .catch((error: unknown) => {
      console.error(`${label} failed`, error)
      return []
    })
}

export const sweepLeases = (db: Database, now?: Date) => logged(sweepExpiredClaims(db, now), "lease sweep", (ids) => `lease ran out on ${ids.map((id) => `#${id}`).join(", ")}`)
export const sweepAreas = (db: Database, now?: Date) => logged(sweepExpiredAreas(db, now), "area sweep", (ids) => `area ran out: ${ids.join(", ")}`)
export const sweepOfflineMachines = (db: Database, now?: Date) => logged(sweepMachines(db, now), "machine sweep", (ids) => `machine went offline: ${ids.join(", ")}`)

export async function sweepOnce(db: Database, now = new Date()): Promise<SweepResult> {
  const [leases, areas, machines] = await Promise.all([sweepLeases(db, now), sweepAreas(db, now), sweepOfflineMachines(db, now)])
  return { leases, areas, machines }
}

export function startSweeper(db: Database, everyMs: number): () => void {
  const timer = setInterval(() => {
    void sweepLeases(db)
    void sweepAreas(db)
  }, everyMs)
  const machineTimer = setInterval(() => void sweepOfflineMachines(db), machineLimits.heartbeatSeconds * 1000)
  return () => {
    clearInterval(timer)
    clearInterval(machineTimer)
  }
}
