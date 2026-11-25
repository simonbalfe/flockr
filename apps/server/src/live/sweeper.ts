import { sweepExpiredAreas } from "../board/areas"
import { sweepExpiredClaims } from "../board/claims"
import { machineLimits } from "@flockr/contracts"
import type { Database } from "../db/client"
import { sweepMachines } from "../board/machines"

export function startSweeper(db: Database, everyMs: number): () => void {
  const timer = setInterval(() => {
    sweepExpiredClaims(db)
      .then((ids) => ids.length && console.log(`lease ran out on ${ids.map((id) => `#${id}`).join(", ")}`))
      .catch((error: unknown) => console.error("sweep failed", error))
    sweepExpiredAreas(db)
      .then((ids) => ids.length && console.log(`area ran out: ${ids.join(", ")}`))
      .catch((error: unknown) => console.error("area sweep failed", error))
  }, everyMs)
  const machineTimer = setInterval(() => {
    sweepMachines(db)
      .then((ids) => ids.length && console.log(`machine went offline: ${ids.join(", ")}`))
      .catch((error: unknown) => console.error("machine sweep failed", error))
  }, machineLimits.heartbeatSeconds * 1000)
  return () => {
    clearInterval(timer)
    clearInterval(machineTimer)
  }
}
