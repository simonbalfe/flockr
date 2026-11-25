import { createApp } from "./app"
import { databaseUrl } from "./config"
import { connect, type Connection } from "./db/client"

declare global {
  var flockrDevConnection: Connection | undefined
}

globalThis.flockrDevConnection ??= connect(databaseUrl)

export default createApp(globalThis.flockrDevConnection.db)
