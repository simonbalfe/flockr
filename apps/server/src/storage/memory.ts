import type { ObjectStore } from "./store"

export function memoryStore(): ObjectStore & { keys: () => string[] } {
  const objects = new Map<string, Uint8Array>()
  return {
    put: async (key, body) => void objects.set(key, body),
    get: async (key) => objects.get(key) ?? null,
    list: async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
    remove: async (key) => void objects.delete(key),
    keys: () => [...objects.keys()].sort(),
  }
}
