import { existsSync } from "node:fs"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { baseCandidates, pickBase, worktreeFolder } from "./paths"
import type { RunIn, Workspace, WorkspaceRequest, WorkspaceResult } from "./types"

export interface GitWorkspaceOptions {
  root: string
  run: (cwd: string, argv: readonly string[]) => ReturnType<RunIn>
  exists?: (folder: string) => boolean
  makeFolder?: (folder: string) => void
}

export function gitWorkspace(options: GitWorkspaceOptions): Workspace {
  const exists = options.exists ?? existsSync
  const makeFolder = options.makeFolder ?? ((folder: string) => void mkdirSync(folder, { recursive: true }))
  const git = (cwd: string, ...args: string[]) => options.run(cwd, ["git", ...args])

  async function refExists(cwd: string, ref: string): Promise<boolean> {
    return (await git(cwd, "rev-parse", "--verify", "--quiet", ref)).code === 0
  }

  async function prepare(request: WorkspaceRequest): Promise<WorkspaceResult> {
    const plain = (reason: string): WorkspaceResult => ({ kind: "plain", folder: request.folder, reason })
    const top = await git(request.folder, "rev-parse", "--show-toplevel")
    if (top.code !== 0) return plain("not a git repository")
    const repoRoot = top.stdout.trim()
    const target = worktreeFolder({ root: options.root, repoRoot, taskId: request.taskId })
    if (exists(target)) {
      const head = await git(target, "rev-parse", "--abbrev-ref", "HEAD")
      if (head.code === 0 && head.stdout.trim() === request.branch) return { kind: "worktree", folder: target, branch: request.branch, created: false }
      return plain(`${target} exists but is not on ${request.branch}`)
    }
    await git(repoRoot, "fetch", "--quiet", "origin")
    makeFolder(path.dirname(target))
    const remoteBranch = `origin/${request.branch}`
    const added = await (async () => {
      if (await refExists(repoRoot, `refs/heads/${request.branch}`)) return git(repoRoot, "worktree", "add", target, request.branch)
      if (await refExists(repoRoot, `refs/remotes/${remoteBranch}`)) return git(repoRoot, "worktree", "add", "-b", request.branch, target, remoteBranch)
      const head = await git(repoRoot, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
      const existing = new Set<string>()
      for (const name of [...baseCandidates, head.stdout.trim()]) if (name && (await refExists(repoRoot, name))) existing.add(name)
      const base = pickBase({ remoteHead: head.code === 0 ? head.stdout.trim() : null, candidates: baseCandidates, existing }) ?? "HEAD"
      return git(repoRoot, "worktree", "add", "-b", request.branch, target, base)
    })()
    if (added.code !== 0) return plain(`git worktree add failed: ${added.stderr.trim()}`)
    return { kind: "worktree", folder: target, branch: request.branch, created: true }
  }

  return { name: "git", label: "Git worktree per task", prepare }
}
