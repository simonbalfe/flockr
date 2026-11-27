import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { ObjectStore } from "./store"

const isCode = (error: unknown, code: string) => error instanceof Error && "code" in error && error.code === code

export function fileStore(root: string): ObjectStore {
  const fileOf = (key: string) => {
    const target = path.resolve(root, key)
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Object key ${key} leaves the store folder`)
    return target
  }

  async function walk(folder: string): Promise<string[]> {
    try {
      const entries = await readdir(folder, { withFileTypes: true })
      const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : Promise.resolve([path.join(folder, entry.name)]))))
      return nested.flat()
    } catch (error) {
      if (isCode(error, "ENOENT")) return []
      throw error
    }
  }

  return {
    async put(key, body) {
      const file = fileOf(key)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(`${file}.tmp`, body)
      await rename(`${file}.tmp`, file)
    },
    async create(key, body) {
      const file = fileOf(key)
      await mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      await writeFile(temp, body)
      try {
        await link(temp, file)
        return "created"
      } catch (error) {
        if (isCode(error, "EEXIST")) return "exists"
        throw error
      } finally {
        await rm(temp, { force: true })
      }
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(fileOf(key)))
      } catch (error) {
        if (isCode(error, "ENOENT")) return null
        throw error
      }
    },
    async list(prefix) {
      const base = path.resolve(root)
      const keys = (await walk(base)).map((file) => path.relative(base, file).split(path.sep).join("/"))
      return keys.filter((key) => key.startsWith(prefix) && !key.endsWith(".tmp")).sort()
    },
    async remove(key) {
      await rm(fileOf(key), { force: true })
    },
  }
}
