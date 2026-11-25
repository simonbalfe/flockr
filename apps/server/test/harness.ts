import { memberHeader } from "@flockr/contracts"
import postgres from "postgres"
import { createApp } from "../src/app"
import { testDatabaseUrl } from "../src/config"
import { connect, type Connection } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { resetBoard, seedBoard } from "../src/seed/seed"

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url)
  const name = target.pathname.slice(1)
  const admin = new URL(url)
  admin.pathname = "/postgres"
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => undefined })
  const found = await sql`select 1 from pg_database where datname = ${name}`
  if (!found.length) await sql.unsafe(`create database "${name}"`)
  await sql.end()
}

let shared: Promise<Connection> | undefined

export function testConnection(): Promise<Connection> {
  shared ??= (async () => {
    await ensureDatabase(testDatabaseUrl)
    const connection = connect(testDatabaseUrl, 20)
    await runMigrations(connection.db)
    return connection
  })()
  return shared
}

export async function freshBoard() {
  const connection = await testConnection()
  await resetBoard(connection.db)
  await seedBoard(connection.db)
  const app = createApp(connection.db)
  const call = async (member: string, method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { [memberHeader]: member, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json: unknown = await response.json()
    return { status: response.status, json }
  }
  return { connection, app, db: connection.db, call }
}
