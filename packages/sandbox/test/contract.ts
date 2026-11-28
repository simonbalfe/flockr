import { describe, expect, test } from "bun:test"
import { sweepSandboxes, type SandboxProvider } from "../src/sandbox"

export interface ContractOptions {
  image: string
  diskMb: number
  diskCap: { diskMb: number; writeMb: number } | null
  settleMs: number
}

const text = (bytes: Uint8Array | null) => new TextDecoder().decode(bytes ?? new Uint8Array())

export function sandboxContract(name: string, sandbox: () => SandboxProvider, options: ContractOptions): void {
  const { image, diskMb } = options

  describe(name, () => {
    test("runs commands as a non-root user, keeps files, and stops safely twice", async () => {
      const box = await sandbox().start({ image, timeLimitSeconds: 300, diskMb, labels: { task: "806" } })
      try {
        expect((await sandbox().status(box.id)).state).toBe("running")
        expect((await sandbox().status(box.id)).labels).toEqual({ task: "806" })
        const who = await sandbox().run(box.id, ["id", "-u"])
        expect(who.stdout.trim()).toBe("1000")

        await sandbox().writeFile(box.id, "notes/plan.md", "# Users table\n")
        expect(text(await sandbox().readFile(box.id, "notes/plan.md"))).toBe("# Users table\n")
        expect(await sandbox().readFile(box.id, "nothing.md")).toBeNull()

        const piped = await sandbox().run(box.id, ["sh", "-c", 'cat; echo " $GREETING"'], { stdin: "hello", env: { GREETING: "from 806" }, cwd: "notes" })
        expect(piped).toMatchObject({ exitCode: 0, stdout: "hello from 806\n", timedOut: false, truncated: false })
        expect((await sandbox().run(box.id, ["sh", "-c", "exit 3"])).exitCode).toBe(3)
        expect((await sandbox().run(box.id, ["sleep", "5"], { timeoutSeconds: 1 })).timedOut).toBe(true)
        const long = await sandbox().run(box.id, ["sh", "-c", "seq 1 20000"], { maxOutputBytes: 100 })
        expect(long.truncated).toBe(true)
        expect(long.stdout.endsWith("19999\n20000\n")).toBe(true)
        expect(long.stdout.length).toBeLessThanOrEqual(100)
      } finally {
        await sandbox().stop(box.id)
        await sandbox().stop(box.id)
      }
      expect((await sandbox().status(box.id)).state).toBe("missing")
    })

    test("the root filesystem is not writable and the disk cap holds", async () => {
      const box = await sandbox().start({ image, timeLimitSeconds: 300, diskMb: options.diskCap?.diskMb ?? diskMb })
      try {
        expect((await sandbox().run(box.id, ["touch", "/etc/x"])).exitCode).not.toBe(0)
        expect((await sandbox().run(box.id, ["touch", "/workspace/x"])).exitCode).toBe(0)
        if (options.diskCap) {
          const big = await sandbox().run(box.id, ["sh", "-c", `dd if=/dev/zero of=/workspace/big bs=1M count=${options.diskCap.writeMb}`])
          expect(big.exitCode).not.toBe(0)
          expect(big.stderr).toContain("No space left")
        }
      } finally {
        await sandbox().stop(box.id)
      }
    })

    test("a box removes itself at its time limit, and the sweeper removes expired ones", async () => {
      const short = await sandbox().start({ image, timeLimitSeconds: 1, diskMb })
      await new Promise((resolve) => setTimeout(resolve, options.settleMs))
      expect((await sandbox().status(short.id)).state).toBe("missing")

      const box = await sandbox().start({ image, timeLimitSeconds: 120, diskMb, labels: { task: "sweep" } })
      expect((await sandbox().list()).map((b) => b.id)).toContain(box.id)
      const removed = await sweepSandboxes(sandbox(), new Date(Date.now() + 121_000))
      expect(removed).toContain(box.id)
      expect((await sandbox().status(box.id)).state).toBe("missing")
      expect((await sandbox().list()).map((b) => b.id)).not.toContain(box.id)
    })

    test("network none has no way out", async () => {
      const box = await sandbox().start({ image, timeLimitSeconds: 120, diskMb, network: "none" })
      try {
        expect((await sandbox().run(box.id, ["sh", "-c", "wget -q -T 2 -O - http://1.1.1.1 || curl -s -m 2 http://1.1.1.1"])).exitCode).not.toBe(0)
      } finally {
        await sandbox().stop(box.id)
      }
    })
  })
}
