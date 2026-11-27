export type CreateResult = "created" | "exists"

export interface ObjectStore {
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>
  create: (key: string, body: Uint8Array, contentType: string) => Promise<CreateResult>
  get: (key: string) => Promise<Uint8Array | null>
  list: (prefix: string) => Promise<string[]>
  remove: (key: string) => Promise<void>
}
