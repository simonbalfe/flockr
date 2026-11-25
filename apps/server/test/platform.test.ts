import { describe, expect, test } from "bun:test"
import path from "node:path"

const src = path.resolve(import.meta.dirname, "../src")
const platformFiles = ["worker.ts", "main.ts", "dev.ts", "dev-app.ts"]

const forbidden: { label: string; pattern: RegExp }[] = [
  { label: "a cloudflare: import", pattern: /from\s+["']cloudflare:/ },
  { label: "a Cloudflare binding", pattern: /\benv\.(HYPERDRIVE|BOARD_ROOM|AGENT|EMAIL)\b/ },
  { label: "a Bun API", pattern: /\bBun\.|from\s+["']bun(:|["'])/ },
  { label: "Postgres LISTEN/NOTIFY", pattern: /pg_notify|\b(sql|client)\.listen\(/ },
]

describe("platform boundary (ADR 0017)", () => {
  test("only the platform folder and entry files touch a platform", async () => {
    const offenders: string[] = []
    for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: src })) {
      if (file.startsWith("platform/") || platformFiles.includes(file)) continue
      const text = await Bun.file(path.join(src, file)).text()
      for (const { label, pattern } of forbidden) if (pattern.test(text)) offenders.push(`${file}: ${label}`)
    }
    expect(offenders).toEqual([])
  })
})
