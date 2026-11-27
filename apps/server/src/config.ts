import { homedir } from "node:os"
import path from "node:path"
import { authConfig } from "./auth/settings"

export const databaseUrl = process.env.DATABASE_URL ?? "postgres://flockr:flockr@127.0.0.1:5432/flockr"
export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://flockr:flockr@127.0.0.1:5432/flockr_test"
export const host = process.env.HOST ?? "127.0.0.1"
export const port = Number(process.env.PORT ?? 5173)
export const boardId = "acme"
export const sweepEveryMs = 30_000
export const eventChannel = "flockr_events"
export const activityChannel = "flockr_activity"
export const readAuthConfig = () => authConfig(process.env, `http://localhost:${port}`)
export const objectsDir = () => process.env.FLOCKR_OBJECTS_DIR ?? path.join(homedir(), ".local/share/flockr/objects")
