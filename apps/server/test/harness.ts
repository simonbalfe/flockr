import { memberHeader } from "@flockr/contracts"
import postgres from "postgres"
import { createApp } from "../src/app"
import { createKey } from "../src/board/keys"
import { testDatabaseUrl } from "../src/config"
import { connect, type Connection } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { logEmail } from "../src/email/log"
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

export async function securedBoard() {
  const board = await freshBoard()
  const { call } = board
  await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
  await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
  await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
  await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
  for (const name of ["ana", "acme-bot"]) await call("simon", "PUT", `/api/channels/acme-site/members/${name}`)
  const secured = createApp(board.db, { auth: { mode: "on", people: new Map([["simon@example.com", "simon"]]), secret: "test-secret-for-the-governance-tests", baseURL: "http://localhost", email: logEmail(() => undefined) } })
  const bearer = async (path: string, secret: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await secured.request(path, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${secret}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    const text = await response.text()
    return { status: response.status, json: text && response.headers.get("content-type")?.includes("json") ? (JSON.parse(text) as unknown) : null }
  }
  const key = async (member: string, channels: string[] | null = null) => (await createKey(board.db, "simon", { member, channels })).secret
  return { ...board, secured, bearer, key }
}
