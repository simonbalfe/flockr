import path from "node:path"

export const worktreeFolder = (options: { root: string; repoRoot: string; taskId: number }): string =>
  path.join(options.root, path.basename(options.repoRoot), String(options.taskId))

export function pickBase(options: { remoteHead: string | null; candidates: readonly string[]; existing: ReadonlySet<string> }): string | null {
  if (options.remoteHead && options.existing.has(options.remoteHead)) return options.remoteHead
  return options.candidates.find((name) => options.existing.has(name)) ?? null
}

export const baseCandidates = ["origin/main", "origin/master", "main", "master"] as const
