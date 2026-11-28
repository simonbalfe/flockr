import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { SqliteDatabase } from "@earendil-works/chord/sqlite"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { z } from "zod"
import { applyChunks, hostTablePrefix, Ledger, piTables, takeChunk } from "./chunks"
import type { PiState } from "./store"

const stateTable = `${hostTablePrefix}state`
const keys = { ledger: "ledger", restoring: "restoring" } as const

const StateRow = z.object({ value: z.string() })

function kept(database: SqliteDatabase): SqliteDatabase {
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, ...params) => database.run(sql, ...params),
    runCounted: (sql, ...params) => database.runCounted(sql, ...params),
    get: (sql, ...params) => database.get(sql, ...params),
    all: (sql, ...params) => database.all(sql, ...params),
    transaction: (callback) => database.transaction(callback),
    close: async () => undefined,
  }
}

export interface HostState {
  read: (key: string) => Promise<string | null>
  write: (key: string, value: string) => Promise<void>
  clear: (key: string) => Promise<void>
}

export function hostState(database: SqliteDatabase): HostState {
  const ready = database.exec(`create table if not exists ${stateTable} (key text primary key, value text not null)`)
  return {
    async read(key) {
      await ready
      return StateRow.safeParse(await database.get(`select value from ${stateTable} where key = ?`, key)).data?.value ?? null
    },
    async write(key, value) {
      await ready
      await database.run(`insert or replace into ${stateTable} (key, value) values (?, ?)`, key, value)
    },
    async clear(key) {
      await ready
      await database.run(`delete from ${stateTable} where key = ?`, key)
    },
  }
}

export function databaseState(database: SqliteDatabase): PiState {
  const { read, write, clear } = hostState(database)
  const ledger = async (): Promise<Ledger> => {
    const raw = await read(keys.ledger)
    return Ledger.safeParse(raw === null ? {} : JSON.parse(raw)).data ?? {}
  }

  return {
    async hasState() {
      return (await read(keys.restoring)) === null && (await piTables(database)).length > 0
    },
    async rebuild(chunks) {
      const restoring = (await read(keys.restoring)) !== null
      const existing = await piTables(database)
      if (existing.length && !restoring) throw new Error("this agent already has state; a restore only fills an empty agent")
      await write(keys.restoring, "1")
      for (const table of [...existing, "durable_schema"]) await database.exec(`drop table if exists "${table.replace(/"/g, '""')}"`)
      await (await SqliteStorage.open(kept(database))).close(BACKGROUND_CONTEXT)
      await write(keys.ledger, JSON.stringify(await applyChunks(database, chunks)))
      await clear(keys.restoring)
    },
    open: async () => {
      await read(keys.ledger)
      return SqliteStorage.open(kept(database))
    },
    async take() {
      const taken = await takeChunk((work) => database.transaction(work), await ledger())
      return taken && { data: taken.data, commit: () => write(keys.ledger, JSON.stringify(taken.ledger)) }
    },
  }
}
