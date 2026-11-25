import { describe, expect, test } from "bun:test"
import { Task } from "@flockr/contracts"
import postgres from "postgres"
import { createApp } from "../src/app"
import { backUp, backupPrefix, latestBackup, readBackup, restoreDatabase } from "../src/backup/backup"
import { testDatabaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { memoryStore } from "../src/storage/memory"
import { freshBoard } from "./harness"

const restoreUrl = (() => {
  const url = new URL(testDatabaseUrl)
  url.pathname = `${url.pathname}_restore`
  return url.toString()
})()

async function emptyDatabase(url: string) {
  const target = new URL(url)
  const name = target.pathname.slice(1)
  target.pathname = "/postgres"
  const admin = postgres(target.toString(), { max: 1, onnotice: () => undefined })
  await admin.unsafe(`drop database if exists "${name}" with (force)`)
  await admin.unsafe(`create database "${name}"`)
  await admin.end()
  const connection = connect(url, 5)
  await runMigrations(connection.db)
  return connection
}

async function counts(sql: postgres.Sql) {
  const tables = await sql<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public' order by tablename`
  const out: Record<string, number> = {}
  for (const { name } of tables) out[name] = Number((await sql.unsafe<{ n: string }[]>(`select count(*) as n from "${name}"`))[0]?.n)
  return out
}

describe("backups (PL4, ADR 0023)", () => {
  test("a backup restores into an empty database with every row, and ids carry on after it", async () => {
    const { connection, call } = await freshBoard()
    await call("simon", "POST", "/api/channels/backend/messages", { text: "Before the backup", labels: ["ops"] })
    await call("claude", "POST", "/api/tasks/806/claim")
    const made = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "backend", title: "Check the restore" })).json)
    const before = await counts(connection.sql)

    const store = memoryStore()
    const result = await backUp(connection.sql, store, new Date("2026-11-25T03:00:00.000Z"))
    expect(result.key).toBe(`${backupPrefix}2026-11-25T03-00-00Z.json.gz`)
    expect(result.rows).toBe(Object.values(before).reduce((a, b) => a + b, 0))

    const target = await emptyDatabase(restoreUrl)
    try {
      const key = await latestBackup(store)
      expect(key).toBe(result.key)
      const restored = await restoreDatabase(target.sql, await readBackup(store, result.key))
      expect(restored.rows).toBe(result.rows)
      expect(await counts(target.sql)).toEqual(before)

      const app = createApp(target.db)
      const thread = await app.request("/api/tasks/806", { headers: { "x-flockr-member": "simon" } })
      expect(Task.parse(await thread.json()).state).toBe("claimed")
      const next = await app.request("/api/tasks", {
        method: "POST",
        headers: { "x-flockr-member": "simon", "content-type": "application/json" },
        body: JSON.stringify({ channel: "backend", title: "After the restore" }),
      })
      expect(next.status).toBe(200)
      expect(Task.parse(await next.json()).id).toBeGreaterThan(made.id)
      const posted = await app.request("/api/channels/backend/messages", {
        method: "POST",
        headers: { "x-flockr-member": "simon", "content-type": "application/json" },
        body: JSON.stringify({ text: "After the restore" }),
      })
      expect(posted.status).toBeLessThan(300)

      await expect(restoreDatabase(target.sql, await readBackup(store, result.key))).rejects.toThrow("not empty")
    } finally {
      await target.close()
    }
  })

  test("only the newest backups are kept", async () => {
    const { connection } = await freshBoard()
    const store = memoryStore()
    for (let day = 1; day <= 4; day++) await backUp(connection.sql, store, new Date(`2026-11-0${day}T03:00:00.000Z`), 2)
    expect(store.keys()).toEqual([`${backupPrefix}2026-11-03T03-00-00Z.json.gz`, `${backupPrefix}2026-11-04T03-00-00Z.json.gz`])
  })
})
