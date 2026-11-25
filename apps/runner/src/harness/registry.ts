import { claudeCode } from "./claude-code"
import { piDurable } from "./pi-durable"
import type { Harness } from "./types"

export const harnesses: readonly Harness[] = [claudeCode, piDurable]

export const harnessNames = (): string[] => harnesses.map((h) => h.name)

export function harnessFor(name: string): Harness {
  const found = harnesses.find((h) => h.name === name)
  if (!found) throw new Error(`No harness ${name}; known: ${harnessNames().join(", ")}`)
  return found
}
