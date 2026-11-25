import path from "node:path"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import type { Database } from "./client"

export const migrationsFolder = path.resolve(import.meta.dirname, "../../drizzle")

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder })
}
