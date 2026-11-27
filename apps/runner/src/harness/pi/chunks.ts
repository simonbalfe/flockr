import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { z } from "zod"
import { openBunSqlite } from "./sqlite"

export const piChunkFormat = "pi-rows/1"

const skippedTables = new Set(["durable_schema"])

const Value = z.union([z.string(), z.number(), z.null()])
const Row = z.record(z.string(), Value)
type Row = z.infer<typeof Row>

const PiChunk = z.object({
  format: z.literal(piChunkFormat),
  upserts: z.array(z.object({ table: z.string(), row: Row })),
  deletes: z.array(z.object({ table: z.string(), key: Row })),
})
type PiChunk = z.infer<typeof PiChunk>

const Ledger = z.record(z.string(), z.record(z.string(), z.string()))
type Ledger = z.infer<typeof Ledger>

const TableName = z.object({ name: z.string() })
const ColumnInfo = z.object({ name: z.string(), pk: z.number() })

interface TableRows {
  keys: string[]
  rows: Map<string, { row: Row; hash: string }>
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

const hashOf = (row: Row) => createHash("sha256").update(JSON.stringify(row)).digest("hex")

function readTables(db: Database): Map<string, TableRows> {
  const tables = new Map<string, TableRows>()
  const names = z.array(TableName).parse(db.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all())
  for (const { name } of names) {
    if (skippedTables.has(name)) continue
    const columns = z.array(ColumnInfo).parse(db.query(`pragma table_info(${quote(name)})`).all())
    const primary = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
    const keys = (primary.length ? primary : columns).map((c) => c.name)
    const rows = new Map<string, { row: Row; hash: string }>()
    for (const raw of db.query(`select * from ${quote(name)}`).all()) {
      const row = Row.parse(raw)
      rows.set(JSON.stringify(keys.map((k) => row[k] ?? null)), { row, hash: hashOf(row) })
    }
    tables.set(name, { keys, rows })
  }
  return tables
}

const ledgerOf = (tables: Map<string, TableRows>): Ledger =>
  Object.fromEntries([...tables].map(([name, table]) => [name, Object.fromEntries([...table.rows].map(([key, { hash }]) => [key, hash]))]))

function readLedger(file: string): Ledger {
  if (!existsSync(file)) return {}
  const parsed = Ledger.safeParse(JSON.parse(readFileSync(file, "utf8")))
  return parsed.success ? parsed.data : {}
}

function writeLedger(file: string, ledger: Ledger): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(ledger))
  renameSync(`${file}.tmp`, file)
}

export interface TakenChunk {
  data: Uint8Array
  commit: () => void
}

export function takePiChunk(options: { file: string; ledger: string }): TakenChunk | null {
  if (!existsSync(options.file)) return null
  const db = new Database(options.file)
  try {
    db.run("BEGIN")
    const tables = readTables(db)
    db.run("COMMIT")
    const before = readLedger(options.ledger)
    const chunk: PiChunk = { format: piChunkFormat, upserts: [], deletes: [] }
    for (const [name, table] of tables) {
      const known = before[name] ?? {}
      for (const [key, { row, hash }] of table.rows) if (known[key] !== hash) chunk.upserts.push({ table: name, row })
      for (const key of Object.keys(known)) {
        if (table.rows.has(key)) continue
        const values = z.array(Value).parse(JSON.parse(key))
        chunk.deletes.push({ table: name, key: Object.fromEntries(table.keys.map((column, i) => [column, values[i] ?? null])) })
      }
    }
    if (!chunk.upserts.length && !chunk.deletes.length) return null
    const after = ledgerOf(tables)
    return { data: Bun.gzipSync(new TextEncoder().encode(JSON.stringify(chunk))), commit: () => writeLedger(options.ledger, after) }
  } finally {
    db.close()
  }
}

function apply(db: Database, chunk: PiChunk): void {
  for (const { table, row } of chunk.upserts) {
    const columns = Object.keys(row)
    db.query(`insert or replace into ${quote(table)} (${columns.map(quote).join(", ")}) values (${columns.map(() => "?").join(", ")})`).run(...columns.map((c) => row[c] ?? null))
  }
  for (const { table, key } of chunk.deletes) {
    const columns = Object.keys(key)
    db.query(`delete from ${quote(table)} where ${columns.map((c) => `${quote(c)} is ?`).join(" and ")}`).run(...columns.map((c) => key[c] ?? null))
  }
}

const restoringMarker = (file: string) => `${file}.restoring`

export const hasPiState = (file: string): boolean => existsSync(file) && !existsSync(restoringMarker(file))

export async function rebuildPiState(options: { file: string; ledger: string; chunks: readonly Uint8Array[] }): Promise<void> {
  const decoded = options.chunks.map((data) => PiChunk.parse(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(Uint8Array.from(data))))))
  const marker = restoringMarker(options.file)
  if (existsSync(options.file) && !existsSync(marker)) throw new Error(`${options.file} already exists; a restore only fills an empty agent`)
  mkdirSync(path.dirname(options.file), { recursive: true })
  writeFileSync(marker, "")
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${options.file}${suffix}`, { force: true })
  const raw = openBunSqlite(options.file)
  await (await SqliteStorage.open(raw)).close(BACKGROUND_CONTEXT)
  const db = new Database(options.file)
  try {
    db.transaction(() => {
      for (const chunk of decoded) apply(db, chunk)
    })()
    writeLedger(options.ledger, ledgerOf(readTables(db)))
  } finally {
    db.close()
  }
  rmSync(marker, { force: true })
}
