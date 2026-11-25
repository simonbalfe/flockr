import { spawn } from "node:child_process"
import path from "node:path"
import { SandboxSpec, type RunOptions, type RunResult, type SandboxInfo, type SandboxProvider, type SandboxState } from "./sandbox"

// Docker on this machine (ADR 0017: the local adapter). The box runs `sleep <time limit>` as
// its only process with --rm, so it deletes itself when time runs out. The root filesystem is
// read-only and every writable path is one tmpfs, so the disk cap is real.

const owner = "flockr.sandbox"
const expiresLabel = "flockr.expires"
const labelPrefix = "flockr.label."
const workspace = "/workspace"
const user = "1000:1000"

interface Spawned {
  code: number
  stdout: Uint8Array
  stderr: string
  timedOut: boolean
}

function docker(args: string[], input?: Uint8Array | string, timeoutMs?: number): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill("SIGKILL")
        }, timeoutMs)
      : undefined
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 137, stdout: new Uint8Array(Buffer.concat(out)), stderr: Buffer.concat(err).toString("utf8"), timedOut })
    })
    child.stdin.end(input === undefined ? undefined : typeof input === "string" ? input : Buffer.from(input))
  })
}

async function must(args: string[], input?: Uint8Array | string): Promise<string> {
  const result = await docker(args, input)
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim() || `exit ${result.code}`}`)
  return Buffer.from(result.stdout).toString("utf8").trim()
}

const missing = (stderr: string) => /no such (container|object)/i.test(stderr)

function infoFrom(id: string, state: SandboxState, labels: Record<string, string>): SandboxInfo {
  const own: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) if (key.startsWith(labelPrefix)) own[key.slice(labelPrefix.length)] = value
  return { id, state, expiresAt: new Date(Number(labels[expiresLabel] ?? 0)), labels: own }
}

const inWorkspace = (file: string) => (path.posix.isAbsolute(file) ? file : path.posix.join(workspace, file))

export function dockerSandbox(): SandboxProvider {
  return {
    name: "docker",
    capabilities: { sleepsWhenIdle: false, persistentDisk: false, maxSessionSeconds: 24 * 60 * 60, networkPolicies: ["none", "open"] },

    async start(input) {
      const spec = SandboxSpec.parse(input)
      const expiresAt = new Date(Date.now() + spec.timeLimitSeconds * 1000)
      const args = [
        "run", "--detach", "--rm",
        "--label", `${owner}=1`,
        "--label", `${expiresLabel}=${expiresAt.getTime()}`,
        ...Object.entries(spec.labels).flatMap(([key, value]) => ["--label", `${labelPrefix}${key}=${value}`]),
        "--user", user,
        "--read-only",
        "--tmpfs", `${workspace}:rw,exec,mode=1777,size=${spec.diskMb}m`,
        "--tmpfs", "/tmp:rw,exec,mode=1777,size=64m",
        "--workdir", workspace,
        "--env", `HOME=${workspace}`,
        ...Object.entries(spec.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        // tmpfs pages count against the memory limit, so the disk is added to it.
        "--memory", `${spec.memoryMb + spec.diskMb}m`,
        "--cpus", String(spec.cpus),
        "--pids-limit", "512",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--network", spec.network === "none" ? "none" : "bridge",
        "--entrypoint", "sleep",
        spec.image,
        String(spec.timeLimitSeconds),
      ]
      const id = await must(args)
      return infoFrom(id, "running", { [expiresLabel]: String(expiresAt.getTime()), ...Object.fromEntries(Object.entries(spec.labels).map(([k, v]) => [`${labelPrefix}${k}`, v])) })
    },

    async run(id, command, options: RunOptions = {}): Promise<RunResult> {
      if (!command.length) throw new Error("A sandbox command needs at least the program")
      const args = [
        "exec", ...(options.stdin === undefined ? [] : ["--interactive"]),
        "--workdir", options.cwd ? inWorkspace(options.cwd) : workspace,
        ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        id, ...command,
      ]
      const result = await docker(args, options.stdin, options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined)
      return { exitCode: result.code, stdout: Buffer.from(result.stdout).toString("utf8"), stderr: result.stderr, timedOut: result.timedOut }
    },

    async writeFile(id, file, content) {
      const target = inWorkspace(file)
      await must(["exec", "--interactive", id, "sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", target], content)
    },

    async readFile(id, file) {
      const result = await docker(["exec", id, "cat", inWorkspace(file)])
      if (result.code !== 0) {
        if (missing(result.stderr)) throw new Error(`No sandbox ${id}`)
        return null
      }
      return result.stdout
    },

    async status(id) {
      const result = await docker(["inspect", "--format", "{{json .Config.Labels}} {{.State.Status}}", id])
      if (result.code !== 0) return { id, state: "missing", expiresAt: new Date(0), labels: {} }
      const text = Buffer.from(result.stdout).toString("utf8").trim()
      const split = text.lastIndexOf(" ")
      const labels = JSON.parse(text.slice(0, split)) as Record<string, string>
      return infoFrom(id, text.slice(split + 1) === "running" ? "running" : "stopped", labels)
    },

    async logs(id) {
      const result = await docker(["logs", id])
      return `${Buffer.from(result.stdout).toString("utf8")}${result.stderr}`
    },

    async stop(id) {
      const result = await docker(["rm", "--force", id])
      if (result.code !== 0 && !missing(result.stderr)) throw new Error(`docker rm failed: ${result.stderr.trim()}`)
    },

    async list() {
      const ids = (await must(["ps", "--all", "--quiet", "--no-trunc", "--filter", `label=${owner}=1`])).split("\n").filter(Boolean)
      const boxes = await Promise.all(ids.map((id) => this.status(id)))
      return boxes.filter((box) => box.state !== "missing")
    },
  }
}
