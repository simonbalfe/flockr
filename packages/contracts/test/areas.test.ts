import { describe, expect, test } from "bun:test"
import { normalizeAreaPath, pathsOverlap, taskBranch, taskOfBranch } from "../src/areas"

describe("area paths", () => {
  test("a folder covers what is under it, and siblings do not meet", () => {
    expect(pathsOverlap("apps/server", "apps/server/src/board/claims.ts")).toBe(true)
    expect(pathsOverlap("apps/server/src", "apps/web/src")).toBe(false)
    expect(pathsOverlap("apps/server/src/a.ts", "apps/server/src/b.ts")).toBe(false)
    expect(pathsOverlap("apps/server/src/a.ts", "apps/server/src/a.ts")).toBe(true)
  })

  test("globs meet the files they match, and ** meets any depth", () => {
    expect(pathsOverlap("packages/contracts/**", "packages/contracts/src/areas.ts")).toBe(true)
    expect(pathsOverlap("packages/**/*.ts", "packages/client/src/x.ts")).toBe(true)
    expect(pathsOverlap("apps/*/README.md", "apps/web/README.md")).toBe(true)
    expect(pathsOverlap("apps/*/README.md", "apps/web/src")).toBe(false)
    expect(pathsOverlap("src/*.ts", "src/main.rs")).toBe(false)
  })

  test("paths are tidied, and one that leaves the repo is refused", () => {
    expect(normalizeAreaPath("./apps//server/")).toBe("apps/server")
    expect(normalizeAreaPath("/apps/server")).toBe("apps/server")
    expect(normalizeAreaPath("../secrets")).toBeNull()
    expect(normalizeAreaPath("a/../b")).toBeNull()
    expect(normalizeAreaPath("  ")).toBeNull()
  })
})

describe("task branches", () => {
  test("a task's branch is flockr/<id> and reads back to its task", () => {
    expect(taskBranch(806)).toBe("flockr/806")
    expect(taskOfBranch("flockr/806")).toBe(806)
    expect(taskOfBranch("flockr/806-users-table")).toBe(806)
    expect(taskOfBranch("feature/806")).toBeNull()
    expect(taskOfBranch("flockr/x")).toBeNull()
  })
})
