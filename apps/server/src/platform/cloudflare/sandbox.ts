import type { RunResult, SandboxInfo, SandboxProvider } from "@flockr/sandbox/sandbox"
import { cloudflareCapabilities } from "./capabilities"
import { boxIndex, type BoxInfo } from "./sandbox-box"
import { SandboxEnv } from "./env"

const infoOf = (box: BoxInfo): SandboxInfo => ({ id: box.id, state: box.state, expiresAt: new Date(box.expiresAt), labels: { ...box.labels } })

export function cloudflareSandbox(env: unknown): SandboxProvider | null {
  const bindings = SandboxEnv.safeParse(env).data
  const namespace = bindings?.SANDBOX
  const index = boxIndex(env)
  if (!namespace || !index) return null
  const box = (id: string) => namespace.get(namespace.idFromName(id))

  const status = async (id: string): Promise<SandboxInfo> => infoOf(await box(id).status())

  return {
    name: "cloudflare",
    capabilities: cloudflareCapabilities,
    async start(spec) {
      const id = `box-${crypto.randomUUID()}`
      return infoOf(await box(id).start(id, spec))
    },
    async run(id, command, options = {}): Promise<RunResult> {
      const { signal, ...rest } = options
      const runId = crypto.randomUUID()
      const stub = box(id)
      const cancel = () => void stub.cancel(runId).catch(() => undefined)
      signal?.addEventListener("abort", cancel, { once: true })
      try {
        if (signal?.aborted) return { exitCode: 137, stdout: "", stderr: "", timedOut: false, truncated: false }
        return { ...(await stub.run(command, { ...rest, runId })) }
      } finally {
        signal?.removeEventListener("abort", cancel)
      }
    },
    writeFile: (id, file, content) => box(id).writeFile(file, content),
    readFile: (id, file) => box(id).readFile(file),
    status,
    logs: (id) => box(id).logs(),
    stop: (id) => box(id).stop(),
    async list() {
      const entries = await index.list()
      const boxes = await Promise.all(entries.map((entry) => status(entry.id)))
      const gone = boxes.filter((b) => b.state === "missing")
      await Promise.all(gone.map((b) => index.remove(b.id)))
      return boxes.filter((b) => b.state !== "missing")
    },
  }
}
