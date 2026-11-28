import { describe, expect, test } from "bun:test"
import { sandboxContract } from "@flockr/sandbox/contract"
import type { RunResult, SandboxInfo, SandboxProvider } from "@flockr/sandbox/sandbox"
import { z } from "zod"
import { cloudflareCapabilities } from "../src/platform/cloudflare/capabilities"

const url = process.env.FLOCKR_SANDBOX_CONTRACT_URL

const Info = z.object({ id: z.string(), state: z.enum(["running", "asleep", "stopped", "missing"]), expiresAt: z.coerce.date(), labels: z.record(z.string(), z.string()) })
const Result = z.object({ exitCode: z.number(), stdout: z.string(), stderr: z.string(), timedOut: z.boolean(), truncated: z.boolean() })
const Failure = z.object({ error: z.string() })

async function call(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${url}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const json: unknown = await response.json()
  if (!response.ok) throw new Error(Failure.safeParse(json).data?.error ?? `status ${response.status}`)
  return json
}

const text = (content: Uint8Array | string) => (typeof content === "string" ? content : new TextDecoder().decode(content))

const overHttp: SandboxProvider = {
  name: "cloudflare",
  capabilities: cloudflareCapabilities,
  start: async (spec) => Info.parse(await call({ method: "start", spec })),
  run: async (id, command, options = {}): Promise<RunResult> => Result.parse(await call({ method: "run", id, command, options: { ...options, stdin: options.stdin === undefined ? undefined : text(options.stdin) } })),
  writeFile: async (id, path, content) => void (await call({ method: "writeFile", id, path, content: text(content) })),
  readFile: async (id, path) => {
    const encoded = z.string().nullable().parse(await call({ method: "readFile", id, path }))
    return encoded === null ? null : Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  },
  status: async (id): Promise<SandboxInfo> => Info.parse(await call({ method: "status", id })),
  logs: async (id) => z.string().parse(await call({ method: "logs", id })),
  stop: async (id) => void (await call({ method: "stop", id })),
  list: async () => z.array(Info).parse(await call({ method: "list" })),
}

if (url) {
  sandboxContract("cloudflare containers sandbox in wrangler dev (PL6)", () => overHttp, { image: "box", diskMb: 2000, diskCap: null, settleMs: 4000 })

  describe("cloudflare containers sandbox sleeping (PL6)", () => {
    test("a box that slept keeps its files and wakes on the next call", async () => {
      const box = await overHttp.start({ image: "box", timeLimitSeconds: 300, diskMb: 2000, labels: { task: "807" } })
      try {
        await overHttp.writeFile(box.id, "repo/notes.md", "kept across sleep\n")
        expect(Info.parse(await call({ method: "sleep", id: box.id })).state).toBe("asleep")
        expect((await overHttp.status(box.id)).state).toBe("asleep")
        expect(text((await overHttp.readFile(box.id, "repo/notes.md")) ?? "")).toBe("kept across sleep\n")
        expect(await overHttp.status(box.id)).toMatchObject({ state: "running", labels: { task: "807" } })
        expect((await overHttp.run(box.id, ["id", "-u"])).stdout.trim()).toBe("1000")
        expect(await overHttp.logs(box.id)).toContain("woke from its snapshot")
      } finally {
        await overHttp.stop(box.id)
      }
    })
  })
} else {
  describe.skip("cloudflare containers sandbox: run bun run --cwd apps/server sandbox:contract", () => undefined)
}
