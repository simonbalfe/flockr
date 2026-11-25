import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { sandboxFor, sweepSandboxes } from "../src"

// The contract every sandbox adapter holds, run against Docker. Skipped when Docker is not running.
const dockerUp = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
const image = "alpine:3.20"
const sandbox = sandboxFor("docker")

describe.skipIf(!dockerUp)("docker sandbox (PL6)", () => {
  test("runs commands as a non-root user, keeps files, and stops safely twice", async () => {
    const box = await sandbox.start({ image, timeLimitSeconds: 120, diskMb: 32, labels: { task: "806" } })
    try {
      expect((await sandbox.status(box.id)).state).toBe("running")
      expect((await sandbox.status(box.id)).labels).toEqual({ task: "806" })
      const who = await sandbox.run(box.id, ["id", "-u"])
      expect(who.stdout.trim()).toBe("1000")

      await sandbox.writeFile(box.id, "notes/plan.md", "# Users table\n")
      expect(new TextDecoder().decode((await sandbox.readFile(box.id, "notes/plan.md")) ?? new Uint8Array())).toBe("# Users table\n")
      expect(await sandbox.readFile(box.id, "nothing.md")).toBeNull()

      const piped = await sandbox.run(box.id, ["sh", "-c", 'cat; echo " $GREETING"'], { stdin: "hello", env: { GREETING: "from 806" }, cwd: "notes" })
      expect(piped).toMatchObject({ exitCode: 0, stdout: "hello from 806\n", timedOut: false })
      expect((await sandbox.run(box.id, ["sh", "-c", "exit 3"])).exitCode).toBe(3)
      expect((await sandbox.run(box.id, ["sleep", "5"], { timeoutSeconds: 1 })).timedOut).toBe(true)
    } finally {
      await sandbox.stop(box.id)
      await sandbox.stop(box.id)
    }
    expect((await sandbox.status(box.id)).state).toBe("missing")
  })

  test("the disk cap holds and the root filesystem is read-only", async () => {
    const box = await sandbox.start({ image, timeLimitSeconds: 120, diskMb: 8 })
    try {
      const big = await sandbox.run(box.id, ["sh", "-c", "dd if=/dev/zero of=/workspace/big bs=1M count=20"])
      expect(big.exitCode).not.toBe(0)
      expect(big.stderr).toContain("No space left")
      expect((await sandbox.run(box.id, ["touch", "/etc/x"])).exitCode).not.toBe(0)
    } finally {
      await sandbox.stop(box.id)
    }
  })

  test("a box removes itself at its time limit, and the sweeper removes expired ones", async () => {
    const short = await sandbox.start({ image, timeLimitSeconds: 1, diskMb: 8 })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect((await sandbox.status(short.id)).state).toBe("missing")

    const box = await sandbox.start({ image, timeLimitSeconds: 60, diskMb: 8, labels: { task: "sweep" } })
    expect((await sandbox.list()).map((b) => b.id)).toContain(box.id)
    const removed = await sweepSandboxes(sandbox, new Date(Date.now() + 61_000))
    expect(removed).toContain(box.id)
    expect((await sandbox.status(box.id)).state).toBe("missing")
  })

  test("network none has no way out", async () => {
    const box = await sandbox.start({ image, timeLimitSeconds: 60, diskMb: 8, network: "none" })
    try {
      expect((await sandbox.run(box.id, ["wget", "-q", "-T", "2", "-O", "-", "http://1.1.1.1"])).exitCode).not.toBe(0)
    } finally {
      await sandbox.stop(box.id)
    }
  })
})
