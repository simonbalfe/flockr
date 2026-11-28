import type { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import type { TakenChunk } from "./chunks"

export interface PiState {
  hasState: () => Promise<boolean>
  rebuild: (chunks: readonly Uint8Array[]) => Promise<void>
  open: () => Promise<SqliteStorage>
  take: () => Promise<TakenChunk | null>
}

export type PiStore = (member: string) => PiState
