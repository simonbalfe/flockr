import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

export const claudeChunkFormat = "claude-jsonl/1"

const ClaudeChunk = z.object({ format: z.literal(claudeChunkFormat), from: z.number().int().min(0), text: z.string() })

export function claudeSessionFile(options: { env: Record<string, string>; folder: string; id: string }): string {
  const home = options.env.CLAUDE_CONFIG_DIR ?? path.join(options.env.HOME ?? "", ".claude")
  return path.join(home, "projects", options.folder.replace(/[^A-Za-z0-9]/g, "-"), `${options.id}.jsonl`)
}

export function takeClaudeChunk(options: { file: string; from: number }): { data: Uint8Array; to: number } | null {
  if (!existsSync(options.file)) return null
  const bytes = readFileSync(options.file)
  const from = bytes.byteLength < options.from ? 0 : options.from
  const end = bytes.lastIndexOf(0x0a) + 1
  if (end <= from) return null
  const text = bytes.subarray(from, end).toString("utf8")
  return { data: Bun.gzipSync(new TextEncoder().encode(JSON.stringify({ format: claudeChunkFormat, from, text }))), to: end }
}

export function rebuildClaudeFile(options: { file: string; chunks: readonly Uint8Array[] }): number {
  let content = Buffer.alloc(0)
  for (const data of options.chunks) {
    const chunk = ClaudeChunk.parse(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(Uint8Array.from(data)))))
    content = Buffer.concat([content.subarray(0, chunk.from), Buffer.from(chunk.text, "utf8")])
  }
  mkdirSync(path.dirname(options.file), { recursive: true })
  writeFileSync(`${options.file}.tmp`, content)
  renameSync(`${options.file}.tmp`, options.file)
  return content.byteLength
}
