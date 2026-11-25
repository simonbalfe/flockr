// Files Flockr keeps outside Postgres: backups now, attached files later (ADR 0002).
// One interface with one adapter per kind of store; nothing outside an adapter names a provider.
export interface ObjectStore {
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>
  get: (key: string) => Promise<Uint8Array | null>
  list: (prefix: string) => Promise<string[]>
  remove: (key: string) => Promise<void>
}
