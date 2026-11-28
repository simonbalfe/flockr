import { createHash } from "node:crypto"
import type { SqliteDatabase, SqliteExecutor } from "@earendil-works/chord/sqlite"
import { z } from "zod"

export const piChunkFormat = "pi-rows/1"

export const hostTablePrefix = "flockr_"

const skippedTables = new Set(["durable_schema"])
const reservedPrefixes = ["sqlite_", "_cf_", hostTablePrefix]

const Value = z.union([z.string(), z.number(), z.null()])
const Row = z.record(z.string(), Value)
type Row = z.infer<typeof Row>

const PiChunk = z.object({
  format: z.literal(piChunkFormat),
  upserts: z.array(z.object({ table: z.string(), row: Row })),
  deletes: z.array(z.object({ table: z.string(), key: Row })),
})
type PiChunk = z.infer<typeof PiChunk>

export const Ledger = z.record(z.string(), z.record(z.string(), z.string()))
export type Ledger = z.infer<typeof Ledger>

const TableName = z.object({ name: z.string() })
const ColumnInfo = z.object({ name: z.string(), pk: z.number() })

interface TableRows {
  keys: string[]
  rows: Map<string, { row: Row; hash: string }>
}

export interface TakenChunk {
  data: Uint8Array
  commit: () => Promise<void>
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

const hashOf = (row: Row) => createHash("sha256").update(JSON.stringify(row)).digest("hex")

const isPiTable = (name: string) => !skippedTables.has(name) && !reservedPrefixes.some((prefix) => name.startsWith(prefix))

export async function piTables(db: SqliteExecutor): Promise<string[]> {
  const names = z.array(TableName).parse(await db.all("select name from sqlite_master where type = 'table' order by name"))
  return names.map((t) => t.name).filter(isPiTable)
}

async function readTables(db: SqliteExecutor): Promise<Map<string, TableRows>> {
  const tables = new Map<string, TableRows>()
  for (const name of await piTables(db)) {
    const columns = z.array(ColumnInfo).parse(await db.all(`pragma table_info(${quote(name)})`))
    const primary = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
    const keys = (primary.length ? primary : columns).map((c) => c.name)
    const rows = new Map<string, { row: Row; hash: string }>()
    for (const raw of await db.all(`select * from ${quote(name)}`)) {
      const row = Row.parse(raw)
      rows.set(JSON.stringify(keys.map((k) => row[k] ?? null)), { row, hash: hashOf(row) })
    }
    tables.set(name, { keys, rows })
  }
  return tables
}

const ledgerOf = (tables: Map<string, TableRows>): Ledger =>
  Object.fromEntries([...tables].map(([name, table]) => [name, Object.fromEntries([...table.rows].map(([key, { hash }]) => [key, hash]))]))

async function through(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([Uint8Array.from(data)]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

const encode = async (chunk: PiChunk) => through(new TextEncoder().encode(JSON.stringify(chunk)), new CompressionStream("gzip"))

const decode = async (data: Uint8Array) => PiChunk.parse(JSON.parse(new TextDecoder().decode(await through(data, new DecompressionStream("gzip")))))

export type Snapshot = <T>(work: (db: SqliteExecutor) => Promise<T>) => Promise<T>

export async function takeChunk(snapshot: Snapshot, before: Ledger): Promise<{ data: Uint8Array; ledger: Ledger } | null> {
  const tables = await snapshot(readTables)
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
  return { data: await encode(chunk), ledger: ledgerOf(tables) }
}

async function apply(db: SqliteExecutor, chunk: PiChunk): Promise<void> {
  for (const { table, row } of chunk.upserts) {
    const columns = Object.keys(row)
    await db.run(`insert or replace into ${quote(table)} (${columns.map(quote).join(", ")}) values (${columns.map(() => "?").join(", ")})`, ...columns.map((c) => row[c] ?? null))
  }
  for (const { table, key } of chunk.deletes) {
    const columns = Object.keys(key)
    await db.run(`delete from ${quote(table)} where ${columns.map((c) => `${quote(c)} is ?`).join(" and ")}`, ...columns.map((c) => key[c] ?? null))
  }
}

export async function applyChunks(db: SqliteDatabase, chunks: readonly Uint8Array[]): Promise<Ledger> {
  const decoded = await Promise.all(chunks.map(decode))
  return db.transaction(async (tx) => {
    for (const chunk of decoded) await apply(tx, chunk)
    return ledgerOf(await readTables(tx))
  })
}
