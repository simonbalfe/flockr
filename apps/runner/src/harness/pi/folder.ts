import { existsSync, realpathSync } from "node:fs"
import path from "node:path"

export type FolderCheck = { kind: "inside"; path: string } | { kind: "refused"; reason: string }

function realOrNearest(target: string): string {
  const rest: string[] = []
  let current = target
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    rest.unshift(path.basename(current))
    current = parent
  }
  return path.join(realpathSync(current), ...rest)
}

const within = (folder: string, target: string) => target === folder || target.startsWith(`${folder}${path.sep}`)

export function insideFolder(folder: string, requested: string): FolderCheck {
  const outside = { kind: "refused", reason: `${requested} is outside the agent's folder ${folder}. Use a path inside it.` } as const
  if (!requested.trim() || requested.includes("\0")) return { kind: "refused", reason: "The path is empty or not valid." }
  if (/^~(\/|$)/.test(requested)) return outside
  if (!path.isAbsolute(folder) || !existsSync(folder)) return { kind: "refused", reason: `The agent's folder ${folder} does not exist.` }
  const root = realpathSync(folder)
  const real = realOrNearest(path.resolve(root, requested))
  return within(root, real) ? { kind: "inside", path: real } : outside
}
