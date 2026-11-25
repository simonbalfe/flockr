import { jobLimits } from "@flockr/contracts"
import { drainJobs } from "../board/drain"
import { sweepEveryMs } from "../config"
import { connect } from "../db/client"
import { postgresListener, timerScheduler } from "../platform"
import { createHub } from "./hub"
import { startSweeper } from "./sweeper"

export async function startLive(url: string) {
  const connection = connect(url)
  const hub = createHub(connection.db, postgresListener(connection.sql))
  await hub.ready
  const stopSweeper = startSweeper(connection.db, sweepEveryMs)
  const stopJobs = timerScheduler(jobLimits.drainEverySeconds * 1000).start(async () => {
    const drained = await drainJobs(connection.db)
    if (drained.ran || drained.failed) console.log(`jobs: ${drained.ran} ran, ${drained.retrying} to retry, ${drained.failed} failed`)
  })
  return {
    hub,
    async stop(): Promise<void> {
      stopSweeper()
      stopJobs()
      await hub.close()
      await connection.close()
    },
  }
}
