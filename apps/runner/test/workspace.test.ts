import { describe, expect, test } from "bun:test"
import { gitWorkspace } from "../src/workspace/git"
import { pickBase, worktreeFolder } from "../src/workspace/paths"
import type { Workspace } from "../src/workspace/types"
import { event, messageThread, setup, task } from "./fakes"

type Reply = { code: number; stdout?: string; stderr?: string }

function fakeGit(replies: Record<string, Reply>, existing: string[] = []) {
  const calls: string[] = []
  const run = async (cwd: string, argv: readonly string[]) => {
    const line = argv.slice(1).join(" ")
    calls.push(`${cwd}: ${line}`)
    const found = replies[line] ?? { code: 1 }
    return { code: found.code, stdout: found.stdout ?? "", stderr: found.stderr ?? "" }
  }
  const workspace = gitWorkspace({ root: "/home/me/.flockr/worktrees", run, exists: (folder) => existing.includes(folder), makeFolder: () => undefined })
  return { workspace, calls }
}

const repo = { "rev-parse --show-toplevel": { code: 0, stdout: "/work/flockr\n" } }

describe("worktree paths", () => {
  test("a task's worktree sits under the runner's folder, by repo name and task id, outside the repo", () => {
    expect(worktreeFolder({ root: "/home/me/.flockr/worktrees", repoRoot: "/work/flockr", taskId: 806 })).toBe("/home/me/.flockr/worktrees/flockr/806")
  })

  test("the base is the remote's default branch, else main, else master", () => {
    const candidates = ["origin/main", "origin/master", "main", "master"]
    expect(pickBase({ remoteHead: "origin/develop", candidates, existing: new Set(["origin/develop", "main"]) })).toBe("origin/develop")
    expect(pickBase({ remoteHead: null, candidates, existing: new Set(["master", "main"]) })).toBe("main")
    expect(pickBase({ remoteHead: null, candidates, existing: new Set() })).toBeNull()
  })
})

describe("git workspace", () => {
  test("a folder that is not a git repository is used as it is", async () => {
    const { workspace } = fakeGit({})
    expect(await workspace.prepare({ folder: "/work/notes", taskId: 806, branch: "flockr/806" })).toEqual({ kind: "plain", folder: "/work/notes", reason: "not a git repository" })
  })

  test("a new task gets a worktree on flockr/<id> made from the default branch", async () => {
    const { workspace, calls } = fakeGit({
      ...repo,
      "symbolic-ref --short refs/remotes/origin/HEAD": { code: 0, stdout: "origin/main\n" },
      "rev-parse --verify --quiet origin/main": { code: 0 },
      "worktree add -b flockr/806 /home/me/.flockr/worktrees/flockr/806 origin/main": { code: 0 },
    })
    const result = await workspace.prepare({ folder: "/work/flockr/apps", taskId: 806, branch: "flockr/806" })
    expect(result).toEqual({ kind: "worktree", folder: "/home/me/.flockr/worktrees/flockr/806", branch: "flockr/806", created: true })
    expect(calls.some((c) => c.includes("push"))).toBe(false)
  })

  test("a branch another machine already pushed is checked out from the remote, not started over", async () => {
    const { workspace } = fakeGit({
      ...repo,
      "rev-parse --verify --quiet refs/remotes/origin/flockr/806": { code: 0 },
      "worktree add -b flockr/806 /home/me/.flockr/worktrees/flockr/806 origin/flockr/806": { code: 0 },
    })
    expect((await workspace.prepare({ folder: "/work/flockr", taskId: 806, branch: "flockr/806" })).kind).toBe("worktree")
  })

  test("a worktree that already exists on the branch is reused, and one on another branch is not touched", async () => {
    const target = "/home/me/.flockr/worktrees/flockr/806"
    const reuse = fakeGit({ ...repo, "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "flockr/806\n" } }, [target])
    expect(await reuse.workspace.prepare({ folder: "/work/flockr", taskId: 806, branch: "flockr/806" })).toMatchObject({ kind: "worktree", folder: target, created: false })
    expect(reuse.calls.some((c) => c.includes("worktree add"))).toBe(false)
    const other = fakeGit({ ...repo, "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" } }, [target])
    expect((await other.workspace.prepare({ folder: "/work/flockr", taskId: 806, branch: "flockr/806" })).kind).toBe("plain")
  })
})

describe("the runner and its workspace", () => {
  const worktree: Workspace = {
    name: "fake",
    label: "Fake",
    prepare: async (request) => ({ kind: "worktree", folder: `/wt/${request.taskId}`, branch: request.branch, created: true }),
  }

  test("a claimed task's session starts in its worktree and its prompt names the branch and how to report", async () => {
    const { runner, board, started } = setup({ workspace: worktree })
    board.tasks.set(830, task({ id: 830 }))
    await runner.receive(event({ type: "task.created", actor: "simon", taskId: 830, threadId: "830", data: { state: "ready" } }))
    expect(started[0]?.spec.folder).toBe("/wt/830")
    expect(started[0]?.spec.prompt).toContain("separate git worktree on branch flockr/830")
    expect(started[0]?.spec.prompt).toContain("flockr areas declare general <path>... --task 830")
    expect(started[0]?.spec.prompt).toContain("flockr tasks commit 830 <sha>")
  })

  test("a conversation that is not a task keeps the channel's folder", async () => {
    const { runner, board, started } = setup({ workspace: worktree })
    board.threads.set("m10", messageThread("m10", "simon", "@claude hello"))
    await runner.receive(event({ type: "message.posted", actor: "simon", messageId: "m10", threadId: "m10", data: { mentions: ["claude"] } }))
    expect(started[0]?.spec.folder).toBe("/tmp/flockr-general")
  })

  test("a hand-off to this member adopts the task; a hand-off away from it stops the run without releasing", async () => {
    const taking = setup({ workspace: worktree })
    taking.board.tasks.set(830, task({ id: 830, state: "claimed", holder: "claude", assignee: "claude", claimEpoch: 3 }))
    await taking.runner.receive(event({ type: "task.handed_off", actor: "codex", taskId: 830, threadId: "830", data: { state: "claimed", from: "codex", to: "claude" } }))
    expect(taking.started).toHaveLength(1)
    expect(taking.started[0]?.spec.folder).toBe("/wt/830")
    expect(taking.epochs.all.get(830)).toBe(3)
    await taking.runner.receive(event({ type: "task.handed_off", actor: "claude", taskId: 830, threadId: "830", data: { state: "claimed", from: "claude", to: "codex" } }))
    expect(taking.started[0]?.stopped).toBe(true)
    await taking.runner.idle()
    await taking.runner.idle()
    expect(taking.board.calls.some((c) => c.startsWith("release") || c.startsWith("submit") || c.startsWith("block"))).toBe(false)
  })
})
