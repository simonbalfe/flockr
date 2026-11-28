import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { applyChunks, Ledger, takeChunk } from "./chunks"
import { openAgentStorage, openBunSqlite } from "./sqlite"
import type { PiState, PiStore } from "./store"

export const ledgerFile = (stateFile: string) => `${stateFile}.chunks.json`

const restoringMarker = (file: string) => `${file}.restoring`

function readLedger(file: string): Ledger {
  if (!existsSync(file)) return {}
  const parsed = Ledger.safeParse(JSON.parse(readFileSync(file, "utf8")))
  return parsed.success ? parsed.data : {}
}

function writeLedger(file: string, ledger: Ledger): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(ledger))
  renameSync(`${file}.tmp`, file)
}

export function fileState(file: string): PiState {
  const ledger = ledgerFile(file)
  const marker = restoringMarker(file)
  return {
    hasState: async () => existsSync(file) && !existsSync(marker),
    async rebuild(chunks) {
      if (existsSync(file) && !existsSync(marker)) throw new Error(`${file} already exists; a restore only fills an empty agent`)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(marker, "")
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true })
      await (await SqliteStorage.open(openBunSqlite(file))).close(BACKGROUND_CONTEXT)
      const db = openBunSqlite(file)
      try {
        writeLedger(ledger, await applyChunks(db, chunks))
      } finally {
        await db.close()
      }
      rmSync(marker, { force: true })
    },
    open: () => openAgentStorage(file),
    async take() {
      if (!existsSync(file)) return null
      const db = openBunSqlite(file)
      try {
        const taken = await takeChunk(async (work) => {
          await db.exec("BEGIN")
          try {
            return await work(db)
          } finally {
            await db.exec("COMMIT")
          }
        }, readLedger(ledger))
        return taken && { data: taken.data, commit: async () => writeLedger(ledger, taken.ledger) }
      } finally {
        await db.close()
      }
    },
  }
}

export const fileStore = (stateFile: (member: string) => string): PiStore => (member) => fileState(stateFile(member))
