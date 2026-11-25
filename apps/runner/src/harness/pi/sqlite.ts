import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import path from "node:path"
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/chord/sqlite"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"

class Executor implements SqliteExecutor {
  constructor(
    protected readonly db: Database,
    private readonly active: () => boolean,
  ) {}

  protected guard<T>(work: () => T): Promise<T> {
    if (!this.active()) return Promise.reject(new Error("SQLite transaction handle is no longer active"))
    try {
      return Promise.resolve(work())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  exec(sql: string): Promise<void> {
    return this.guard(() => {
      this.db.run(sql)
    })
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.guard(() => {
      this.db.query<unknown, SqliteValue[]>(sql).run(...params)
    })
  }

  runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
    return this.guard(() => this.db.query<unknown, SqliteValue[]>(sql).run(...params).changes)
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.guard(() => this.db.query<T, SqliteValue[]>(sql).get(...params) ?? undefined)
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.guard(() => this.db.query<T, SqliteValue[]>(sql).all(...params))
  }
}

class Queue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work)
    this.tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

export class BunSqliteDatabase extends Executor implements SqliteDatabase {
  private readonly queue = new Queue()
  private closed = false

  constructor(db: Database) {
    super(db, () => true)
  }

  protected override guard<T>(work: () => T): Promise<T> {
    return this.queue.run(() => super.guard(work))
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      this.db.run("BEGIN IMMEDIATE")
      const scope = { active: true }
      try {
        const result = await callback(new Executor(this.db, () => scope.active))
        scope.active = false
        this.db.run("COMMIT")
        return result
      } catch (error) {
        scope.active = false
        try {
          this.db.run("ROLLBACK")
        } catch (rollback) {
          throw new AggregateError([error, rollback], "SQLite transaction failed and rollback failed")
        }
        throw error
      }
    })
  }

  close(): Promise<void> {
    return this.queue.run(async () => {
      if (this.closed) return
      this.closed = true
      try {
        this.db.run("PRAGMA wal_checkpoint(TRUNCATE)")
      } finally {
        this.db.close()
      }
    })
  }
}

export function openBunSqlite(file: string): BunSqliteDatabase {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file, { create: true, strict: false })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  return new BunSqliteDatabase(db)
}

export const openAgentStorage = (file: string): Promise<SqliteStorage> => SqliteStorage.open(openBunSqlite(file))
