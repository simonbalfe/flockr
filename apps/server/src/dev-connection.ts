import { databaseUrl } from "./config"
import { connect, type Connection } from "./db/client"

declare global {
  var flockrDevConnection: Connection | undefined
}

export const devConnection = (): Connection => (globalThis.flockrDevConnection ??= connect(databaseUrl))
