import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

export type Database = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]
export type Executor = Database | Tx

export interface Connection {
  db: Database
  sql: postgres.Sql
  close: () => Promise<void>
}

export function connect(url: string, max = 10): Connection {
  const sql = postgres(url, { max, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  return { db, sql, close: () => sql.end({ timeout: 5 }) }
}
