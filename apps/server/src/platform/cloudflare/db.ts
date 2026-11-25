import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import type { Connection } from "../../db/client"
import * as schema from "../../db/schema"

export function connectWorker(connectionString: string): Connection {
  const sql = postgres(connectionString, { max: 5, fetch_types: false, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  return { db, sql, close: () => sql.end({ timeout: 5 }) }
}
