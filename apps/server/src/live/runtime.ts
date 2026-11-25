import { sweepEveryMs } from "../config"
import { connect } from "../db/client"
import { createHub } from "./hub"
import { startSweeper } from "./sweeper"

export async function startLive(url: string) {
  const connection = connect(url)
  const hub = createHub(connection)
  await hub.ready
  const stopSweeper = startSweeper(connection.db, sweepEveryMs)
  return {
    hub,
    async stop(): Promise<void> {
      stopSweeper()
      await hub.close()
      await connection.close()
    },
  }
}
