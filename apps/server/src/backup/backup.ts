import type postgres from "postgres"
import { z } from "zod"
import type { ObjectStore } from "../storage/store"


export const backupPrefix = "backups/"
export const backupsKept = 30
const format = "flockr-backup/1"

const Row = z.record(z.string(), z.unknown())
export const Backup = z.object({
  format: z.literal(format),
  takenAt: z.string(),
  migrations: z.object({ count: z.number().int(), last: z.string().nullable() }),
  tables: z.array(z.object({ name: z.string(), rows: z.array(Row) })),
})
export type Backup = z.infer<typeof Backup>

type Sql = postgres.Sql | postgres.TransactionSql

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

async function tableNames(sql: Sql): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public' order by tablename`
  return rows.map((row) => row.name)
}

async function loadOrder(sql: Sql, tables: string[]): Promise<string[]> {
  const edges = await sql<{ child: string; parent: string }[]>`
    select child.relname as child, parent.relname as parent
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace n on n.oid = child.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid`
  const order: string[] = []
  const left = new Set(tables)
  while (left.size) {
    const ready = [...left].filter((table) => !edges.some((edge) => edge.child === table && left.has(edge.parent)))
    if (!ready.length) throw new Error(`Foreign keys form a cycle between ${[...left].join(", ")}; a restore cannot order them`)
    for (const table of ready) {
      order.push(table)
      left.delete(table)
    }
  }
  return order
}

async function migrationState(sql: Sql): Promise<{ hashes: string[] }> {
  const found = await sql<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`
  if (!found[0]?.exists) return { hashes: [] }
  const rows = await sql<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations order by id`
  return { hashes: rows.map((row) => row.hash) }
}

export async function dumpDatabase(sql: postgres.Sql, now: Date): Promise<Backup> {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const { hashes } = await migrationState(tx)
    const tables = []
    for (const name of await loadOrder(tx, await tableNames(tx))) {
      const result = await tx.unsafe<{ rows: string }[]>(`select coalesce(json_agg(t), '[]'::json)::text as rows from ${ident(name)} t`)
      tables.push({ name, rows: z.array(Row).parse(JSON.parse(result[0]?.rows ?? "[]")) })
    }
    return { format, takenAt: now.toISOString(), migrations: { count: hashes.length, last: hashes.at(-1) ?? null }, tables }
  }) as Promise<Backup>
}

interface Column {
  table: string
  name: string
  identityAlways: boolean
  sequence: string | null
}

async function insertableColumns(sql: Sql): Promise<Column[]> {
  const rows = await sql<{ table: string; name: string; identity: string; sequence: string | null }[]>`
    select c.relname as table, a.attname as name, a.attidentity as identity,
      pg_get_serial_sequence(format('%I', c.relname), a.attname) as sequence
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''`
  return rows.map((row) => ({ table: row.table, name: row.name, identityAlways: row.identity === "a", sequence: row.sequence }))
}

export interface RestoreResult {
  tables: number
  rows: number
}

export async function restoreDatabase(sql: postgres.Sql, backup: Backup): Promise<RestoreResult> {
  const { hashes } = await migrationState(sql)
  if (backup.migrations.last && !hashes.includes(backup.migrations.last)) {
    throw new Error(`The target database is not migrated as far as the backup (${backup.migrations.count} migrations); run bun run db:migrate on it first`)
  }
  return sql.begin(async (tx) => {
    const tables = await tableNames(tx)
    for (const table of tables) {
      const used = await tx.unsafe<{ used: boolean }[]>(`select exists (select 1 from ${ident(table)}) as used`)
      if (used[0]?.used) throw new Error(`The target database is not empty (${table} has rows); restore only into a new database`)
    }
    const columns = await insertableColumns(tx)
    const byName = new Map(backup.tables.map((entry) => [entry.name, entry.rows]))
    let restored = 0
    for (const table of await loadOrder(tx, tables)) {
      const rows = byName.get(table) ?? []
      if (!rows.length) continue
      const present = new Set(rows.flatMap((row) => Object.keys(row)))
      const own = columns.filter((column) => column.table === table && present.has(column.name))
      const list = own.map((column) => ident(column.name)).join(", ")
      const overriding = own.some((column) => column.identityAlways) ? " overriding system value" : ""
      await tx.unsafe(`insert into ${ident(table)} (${list})${overriding} select ${list} from json_populate_recordset(null::${ident(table)}, $1::json)`, [JSON.stringify(rows)])
      restored += rows.length
    }
    for (const column of columns) {
      if (!column.sequence || !byName.get(column.table)?.length) continue
      await tx.unsafe(`select setval($1, (select max(${ident(column.name)}) from ${ident(column.table)}))`, [column.sequence])
    }
    return { tables: byName.size, rows: restored }
  }) as Promise<RestoreResult>
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Response(stream).text()
}

export const backupKey = (at: Date) => `${backupPrefix}${at.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-")}.json.gz`

export interface BackupResult {
  key: string
  bytes: number
  rows: number
  removed: string[]
}

export async function backUp(sql: postgres.Sql, store: ObjectStore, now: Date, keep = backupsKept): Promise<BackupResult> {
  const backup = await dumpDatabase(sql, now)
  const key = backupKey(now)
  const body = await gzip(JSON.stringify(backup))
  await store.put(key, body, "application/gzip")
  const all = await store.list(backupPrefix)
  const removed = all.slice(0, Math.max(0, all.length - keep))
  for (const old of removed) await store.remove(old)
  return { key, bytes: body.length, rows: backup.tables.reduce((sum, table) => sum + table.rows.length, 0), removed }
}

export async function latestBackup(store: ObjectStore): Promise<string | null> {
  return (await store.list(backupPrefix)).at(-1) ?? null
}

export async function readBackup(store: ObjectStore, key: string): Promise<Backup> {
  const bytes = await store.get(key)
  if (!bytes) throw new Error(`No backup at ${key}`)
  return Backup.parse(JSON.parse(await gunzip(bytes)))
}
