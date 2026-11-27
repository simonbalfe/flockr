import { fileStore } from "./files"
import { s3SettingsFrom, s3Store } from "./s3"
import type { ObjectStore } from "./store"

export function localObjectStore(env: Record<string, unknown>, folder: string): ObjectStore {
  const settings = s3SettingsFrom(env)
  return settings ? s3Store(settings) : fileStore(folder)
}
