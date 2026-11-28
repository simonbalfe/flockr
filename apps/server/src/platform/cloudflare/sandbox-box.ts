import { DurableObject } from "cloudflare:workers"
import { defaultMaxOutputBytes, readTail, SandboxSpec, sandboxUser, sandboxWorkspace, type SandboxState } from "@flockr/sandbox/sandbox"
import { z } from "zod"
import { SandboxEnv } from "./env"

export const boxTiming = { idleMs: 5 * 60_000, platformIdleMs: 30 * 60_000, readyMs: 30_000, readyPollMs: 100 } as const

export const boxLimits = {
  vcpu: { min: 1 / 16, max: 4 },
  memoryMib: { min: 256, max: 12 * 1024 },
  diskMb: { min: 2000, max: 20_000 },
  labels: 10,
  labelName: 16,
  labelValue: 64,
  logLines: 200,
  readBytes: 32 * 1024 * 1024,
} as const

const boxPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

const dropToBoxUser = [
  "setpriv",
  `--reuid=${sandboxUser.uid}`,
  `--regid=${sandboxUser.gid}`,
  "--clear-groups",
  "--inh-caps=-all",
  "--bounding-set=-all",
  "--no-new-privs",
  "--",
] as const

const setupScript = `mkdir -p ${sandboxWorkspace} && chown ${sandboxUser.uid}:${sandboxUser.gid} ${sandboxWorkspace} && chmod 1777 /tmp`

const liveStates = ["running", "asleep"] as const

const BoxRecord = z.object({
  id: z.string().min(1),
  spec: z.object({
    image: z.string(),
    timeLimitSeconds: z.number(),
    diskMb: z.number(),
    memoryMb: z.number(),
    cpus: z.number(),
    network: z.enum(["none", "open"]),
    env: z.record(z.string(), z.string()),
    labels: z.record(z.string(), z.string()),
  }),
  expiresAt: z.number(),
  lastUsed: z.number(),
  state: z.enum(liveStates),
  snapshot: z.string().nullable(),
})
type BoxRecord = z.infer<typeof BoxRecord>

const LogLines = z.array(z.string())

const keys = { record: "box", log: "log" } as const

export interface BoxInfo {
  id: string
  state: SandboxState
  expiresAt: number
  labels: Record<string, string>
}

export interface BoxRunOptions {
  runId: string
  cwd?: string
  env?: Record<string, string>
  stdin?: Uint8Array | string
  timeoutSeconds?: number
  maxOutputBytes?: number
}

export interface BoxRunResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value))

const inWorkspace = (file: string) => (file.startsWith("/") ? file : `${sandboxWorkspace}/${file}`.replace(/\/+/g, "/"))

const platformLabels = (labels: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(labels)
      .filter(([name, value]) => name.length <= boxLimits.labelName && new TextEncoder().encode(value).byteLength <= boxLimits.labelValue)
      .slice(0, boxLimits.labels),
  )

const missingInfo = (id: string): BoxInfo => ({ id, state: "missing", expiresAt: 0, labels: {} })

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 300)

const streamOf = (input: Uint8Array | string) => new Blob([typeof input === "string" ? input : new Uint8Array(input)]).stream()

export const boxIndexName = "boxes"

export function boxIndex(env: unknown): DurableObjectStub<SandboxIndex> | null {
  const binding = SandboxEnv.safeParse(env).data?.SANDBOX_INDEX
  return binding ? binding.get(binding.idFromName(boxIndexName)) : null
}

export class SandboxBox extends DurableObject {
  private readonly running = new Map<string, ExecProcess>()

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => {
      if (ctx.container?.running) await ctx.container.setInactivityTimeout(boxTiming.platformIdleMs)
    })
  }

  private container(): Container {
    const container = this.ctx.container
    if (!container) throw new Error("This Durable Object has no container: bind its class in the containers section of the wrangler config")
    return container
  }

  private record(): BoxRecord | null {
    const raw = this.ctx.storage.kv.get(keys.record)
    if (raw === undefined) return null
    return BoxRecord.safeParse(raw).data ?? null
  }

  private keep(record: BoxRecord): void {
    this.ctx.storage.kv.put(keys.record, record)
  }

  private log(line: string): void {
    const lines = LogLines.safeParse(this.ctx.storage.kv.get(keys.log)).data ?? []
    this.ctx.storage.kv.put(keys.log, [...lines, `${new Date().toISOString()} ${line}`].slice(-boxLimits.logLines))
  }

  private info(record: BoxRecord): BoxInfo {
    const state: SandboxState = record.state === "asleep" ? "asleep" : this.ctx.container?.running ? "running" : "stopped"
    return { id: record.id, state, expiresAt: record.expiresAt, labels: record.spec.labels }
  }

  private async arm(record: BoxRecord): Promise<void> {
    const idleAt = record.state === "running" ? record.lastUsed + boxTiming.idleMs : record.expiresAt
    await this.ctx.storage.setAlarm(Math.min(record.expiresAt, idleAt))
  }

  private remainingSeconds(record: BoxRecord): number {
    return Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000))
  }

  private async launch(record: BoxRecord, snapshot: string | null): Promise<void> {
    const container = this.container()
    const { spec } = record
    const base = {
      entrypoint: ["sleep", String(this.remainingSeconds(record))],
      enableInternet: spec.network === "open",
      instance: {
        vcpu: clamp(spec.cpus, boxLimits.vcpu),
        memoryMib: clamp(spec.memoryMb, boxLimits.memoryMib),
        diskMb: clamp(spec.diskMb, boxLimits.diskMb),
      },
      labels: platformLabels(spec.labels),
    }
    if (snapshot) container.start({ ...base, containerSnapshot: { id: snapshot } })
    else container.start({ ...base, image: container.images[spec.image] ?? spec.image })
    await container.setInactivityTimeout(boxTiming.platformIdleMs)
    const deadline = Date.now() + boxTiming.readyMs
    for (;;) {
      try {
        const setup = await (await container.exec(["sh", "-c", setupScript], { user: "0:0" })).output()
        if (setup.exitCode !== 0) throw new Error(`the box image could not set up ${sandboxWorkspace}: ${new TextDecoder().decode(setup.stderr).trim()}`)
        return
      } catch (error) {
        if (Date.now() > deadline) throw new Error(`the box did not become ready: ${short(error)}`)
        await new Promise((resolve) => setTimeout(resolve, boxTiming.readyPollMs))
      }
    }
  }

  private async awake(): Promise<BoxRecord> {
    const record = this.record()
    if (!record) throw new Error(`No sandbox ${this.ctx.id.name ?? this.ctx.id.toString()}`)
    if (Date.now() >= record.expiresAt) {
      await this.stop()
      throw new Error(`Sandbox ${record.id} reached its time limit`)
    }
    if (record.state === "asleep") {
      await this.launch(record, record.snapshot)
      this.log("woke from its snapshot")
    } else if (!this.container().running) {
      await this.launch(record, null)
      this.log("the platform had stopped it; started again from the image, files gone")
    }
    const used = { ...record, state: "running" as const, snapshot: null, lastUsed: Date.now() }
    this.keep(used)
    await this.arm(used)
    return used
  }

  async start(id: string, input: SandboxSpec): Promise<BoxInfo> {
    const kept = this.record()
    if (kept) return this.info(kept)
    const spec = SandboxSpec.parse(input)
    const now = Date.now()
    const record: BoxRecord = { id, spec, expiresAt: now + spec.timeLimitSeconds * 1000, lastUsed: now, state: "running", snapshot: null }
    this.keep(record)
    try {
      await this.launch(record, null)
    } catch (error) {
      await this.stop()
      throw error
    }
    await boxIndex(this.env)?.add(id, record.expiresAt)
    await this.arm(record)
    this.log(`started ${spec.image} until ${new Date(record.expiresAt).toISOString()}, network ${spec.network}`)
    return this.info(record)
  }

  private async exec(record: BoxRecord, command: readonly string[], options: BoxRunOptions): Promise<BoxRunResult> {
    const env = { PATH: boxPath, HOME: sandboxWorkspace, ...record.spec.env, ...(options.env ?? {}) }
    const process = await this.container().exec([...dropToBoxUser, ...command], {
      user: "0:0",
      cwd: options.cwd ? inWorkspace(options.cwd) : sandboxWorkspace,
      env,
      ...(options.stdin === undefined ? {} : { stdin: streamOf(options.stdin) }),
    })
    this.running.set(options.runId, process)
    let timedOut = false
    const timer = options.timeoutSeconds
      ? setTimeout(() => {
          timedOut = true
          process.kill(9)
        }, options.timeoutSeconds * 1000)
      : undefined
    try {
      const limit = options.maxOutputBytes ?? defaultMaxOutputBytes
      const [stdout, stderr, exitCode] = await Promise.all([readTail(process.stdout, limit), readTail(process.stderr, limit), process.exitCode])
      return { exitCode, stdout: stdout.text(), stderr: stderr.text(), timedOut, truncated: stdout.truncated || stderr.truncated }
    } finally {
      if (timer) clearTimeout(timer)
      this.running.delete(options.runId)
    }
  }

  async run(command: string[], options: BoxRunOptions): Promise<BoxRunResult> {
    if (!command.length) throw new Error("A sandbox command needs at least the program")
    const record = await this.awake()
    const result = await this.exec(record, command, options)
    await this.used()
    this.log(`ran ${command[0]}: exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}`)
    return result
  }

  private async used(): Promise<void> {
    const record = this.record()
    if (!record || record.state !== "running") return
    const now = { ...record, lastUsed: Date.now() }
    this.keep(now)
    await this.arm(now)
  }

  async cancel(runId: string): Promise<void> {
    this.running.get(runId)?.kill(9)
  }

  async writeFile(file: string, content: Uint8Array | string): Promise<void> {
    const record = await this.awake()
    const result = await this.exec(record, ["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", inWorkspace(file)], { runId: `write:${crypto.randomUUID()}`, stdin: content })
    if (result.exitCode !== 0) throw new Error(`Could not write ${file}: ${result.stderr.trim()}`)
  }

  async readFile(file: string): Promise<Uint8Array | null> {
    const record = await this.awake()
    const process = await this.container().exec([...dropToBoxUser, "cat", "--", inWorkspace(file)], { user: "0:0", cwd: sandboxWorkspace, env: { PATH: boxPath, HOME: sandboxWorkspace, ...record.spec.env } })
    const [bytes, , exitCode] = await Promise.all([readBytes(process.stdout, boxLimits.readBytes), readTail(process.stderr, 4096), process.exitCode])
    if (exitCode !== 0) return null
    if (bytes === null) throw new Error(`${file} is larger than ${boxLimits.readBytes} bytes`)
    return bytes
  }

  async status(): Promise<BoxInfo> {
    const record = this.record()
    return record ? this.info(record) : missingInfo(this.ctx.id.name ?? this.ctx.id.toString())
  }

  async logs(): Promise<string> {
    return (LogLines.safeParse(this.ctx.storage.kv.get(keys.log)).data ?? []).join("\n")
  }

  async sleep(): Promise<BoxInfo> {
    const record = this.record()
    if (!record) return missingInfo(this.ctx.id.name ?? this.ctx.id.toString())
    if (record.state === "asleep" || !this.container().running) return this.info(record)
    for (const process of this.running.values()) process.kill(9)
    const snapshot = await this.container().snapshotContainer({ name: record.id })
    await this.container().destroy()
    const asleep = { ...record, state: "asleep" as const, snapshot: snapshot.id }
    this.keep(asleep)
    await this.arm(asleep)
    this.log(`asleep; snapshot ${snapshot.id}, ${snapshot.size} bytes`)
    return this.info(asleep)
  }

  async stop(): Promise<void> {
    const record = this.record()
    for (const process of this.running.values()) process.kill(9)
    if (this.ctx.container?.running) await this.ctx.container.destroy()
    await this.ctx.storage.deleteAlarm()
    this.ctx.storage.kv.delete(keys.record)
    if (record) {
      await boxIndex(this.env)?.remove(record.id)
      this.log("stopped and removed")
    }
  }

  override async alarm(): Promise<void> {
    const record = this.record()
    if (!record) return
    const now = Date.now()
    if (now >= record.expiresAt) {
      this.log("reached its time limit")
      return this.stop()
    }
    if (record.state === "running" && this.running.size > 0) {
      await this.arm({ ...record, lastUsed: now })
      return
    }
    if (record.state === "running" && now - record.lastUsed >= boxTiming.idleMs) {
      try {
        await this.sleep()
      } catch (error) {
        this.log(`could not sleep: ${short(error)}`)
        await this.arm({ ...record, lastUsed: now })
      }
      return
    }
    await this.arm(record)
  }
}

async function readBytes(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return all
}

const IndexEntry = z.number()

export class SandboxIndex extends DurableObject {
  private static readonly prefix = "box:"

  async add(id: string, expiresAt: number): Promise<void> {
    this.ctx.storage.kv.put(`${SandboxIndex.prefix}${id}`, expiresAt)
  }

  async remove(id: string): Promise<void> {
    this.ctx.storage.kv.delete(`${SandboxIndex.prefix}${id}`)
  }

  async list(): Promise<{ id: string; expiresAt: number }[]> {
    return [...this.ctx.storage.kv.list({ prefix: SandboxIndex.prefix })].flatMap(([key, value]) => {
      const expiresAt = IndexEntry.safeParse(value).data
      return expiresAt === undefined ? [] : [{ id: key.slice(SandboxIndex.prefix.length), expiresAt }]
    })
  }
}
