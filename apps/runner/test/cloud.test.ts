import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const src = path.resolve(import.meta.dir, "../src")
const entry = path.join(src, "cloud/agent.ts")

const forbidden: { label: string; pattern: RegExp }[] = [
  { label: "a Bun import", pattern: /from\s+["']bun(:|["'])/ },
  { label: "a Bun API", pattern: /\bBun\./ },
  { label: "import.meta.dir", pattern: /import\.meta\.dir\b/ },
  { label: "a child process", pattern: /from\s+["']node:child_process["']/ },
  { label: "the Node execution env", pattern: /pi-durable\/env\/node/ },
]

const runtimeImports = (text: string) => [...text.matchAll(/^import\s+(?!type\b)[^"']*["'](\.{1,2}\/[^"']+)["']/gm)].flatMap((m) => (m[1] ? [m[1]] : []))

function graph(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen
  seen.add(file)
  for (const spec of runtimeImports(readFileSync(file, "utf8"))) graph(path.resolve(path.dirname(file), spec.endsWith(".ts") ? spec : `${spec}.ts`), seen)
  return seen
}

describe("the cloud entry (4c)", () => {
  test("bundles for a Worker: nothing it loads imports Bun, the runner's file config, a child process or the Node execution env", () => {
    const files = graph(entry)
    const offenders = [...files].flatMap((file) => {
      const text = readFileSync(file, "utf8")
      const name = path.relative(src, file)
      const config = runtimeImports(text).some((spec) => /(^|\/)config$/.test(spec)) ? [`${name}: the runner's file config`] : []
      return [...config, ...forbidden.filter(({ pattern }) => pattern.test(text)).map(({ label }) => `${name}: ${label}`)]
    })
    expect(files.size).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })
})
