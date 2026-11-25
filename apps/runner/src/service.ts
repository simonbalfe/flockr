import type { Agent, AgentReportEntry, BoardEvent, HarnessInfo } from "@flockr/client"
import { agentEventTypes, machineLimits } from "@flockr/contracts/agents"
import type { MachinePort } from "./board"
import type { Harness } from "./harness/types"
import { realTimers, type AgentSettings, type Timers } from "./runner"
import type { JsonStore, RunnerState } from "./store"

export interface AgentRunner {
  start: () => Promise<void>
  receive: (event: BoardEvent) => Promise<void>
  shutdown: () => Promise<void>
  nudge: () => Promise<void>
  working: () => boolean
  active: () => number
}

export interface Spawn {
  name: string
  harness: Harness
  settings: () => AgentSettings
  hasRoom: () => boolean
  changed: () => void
  freed: () => void
  problem: (reason: string) => void
}

export interface ServiceDeps {
  machine: { id: string; name: string }
  port: MachinePort
  harnesses: readonly Harness[]
  path: string
  maxSessions: number
  folderExists: (folder: string) => boolean
  spawn: (spec: Spawn) => AgentRunner
  state: JsonStore<RunnerState>
  log: (line: string) => void
  timers?: Timers
  retryMs?: number
  onRegistered?: (available: readonly Harness[]) => Promise<void>
}

interface Box {
  settings: AgentSettings
  problem: string | null
}

interface Served {
  runner: AgentRunner
  harness: string
  box: Box
}

const agentEvents = new Set<string>(Object.values(agentEventTypes))

const short = (error: unknown) => {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim()
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

const sameSettings = (a: AgentSettings, b: AgentSettings) => a.folder === b.folder && a.permissions === b.permissions && a.personality === b.personality && a.model === b.model

export const harnessInfo = (harness: Harness): HarnessInfo => ({ id: harness.name, label: harness.label, capabilities: { ...harness.capabilities } })

export function createService(deps: ServiceDeps) {
  const { machine, port, log } = deps
  const timers = deps.timers ?? realTimers
  const served = new Map<string, Served>()
  const problems = new Map<string, string>()
  const cancel: (() => void)[] = []
  let available: readonly Harness[] = []
  let chain: Promise<void> = Promise.resolve()
  let beatQueued = false
  let boardDown = false
  let closing = false

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const next = chain.then(job).catch((error: unknown) => log(`runner: ${short(error)}`))
    chain = next
    return next
  }

  const active = () => [...served.values()].reduce((sum, entry) => sum + entry.runner.active(), 0)
  const hasRoom = () => active() < deps.maxSessions

  function reports(): AgentReportEntry[] {
    const live = [...served].map(([name, entry]): AgentReportEntry => {
      if (entry.box.problem) return { name, state: "error", reason: entry.box.problem }
      return { name, state: entry.runner.working() ? "working" : "serving", reason: null }
    })
    const failing = [...problems].map(([name, reason]): AgentReportEntry => ({ name, state: "error", reason }))
    return [...live, ...failing]
  }

  async function beat(): Promise<Agent[]> {
    try {
      const agents = await port.heartbeat(machine.id, { agents: reports() })
      if (boardDown) log("runner: board reachable again")
      boardDown = false
      return agents
    } catch (error) {
      if (!boardDown) log(`runner: heartbeat failed, will retry: ${short(error)}`)
      boardDown = true
      return []
    }
  }

  function nudgeOthers(name: string): void {
    for (const [other, entry] of served) if (other !== name) void entry.runner.nudge()
  }

  function beatSoon(): void {
    if (beatQueued || closing) return
    beatQueued = true
    void enqueue(async () => {
      beatQueued = false
      await beat()
    })
  }

  async function stopServing(name: string, why: string): Promise<void> {
    const entry = served.get(name)
    if (!entry) return
    served.delete(name)
    await entry.runner.shutdown()
    log(`${name}: stopped serving (${why})`)
  }

  function problemFor(agent: Agent, harness: Harness | undefined): string | null {
    const config = agent.config
    if (!config) return null
    if (!harness) return `Harness ${config.harness} is not available on ${machine.name}`
    if (!deps.folderExists(config.folder)) return `Folder ${config.folder} not found`
    return null
  }

  async function serve(agent: Agent, harness: Harness, settings: AgentSettings): Promise<void> {
    const box: Box = { settings, problem: null }
    const runner = deps.spawn({
      name: agent.name,
      harness,
      settings: () => box.settings,
      hasRoom,
      changed: beatSoon,
      freed: () => nudgeOthers(agent.name),
      problem: (reason) => {
        if (box.problem === reason) return
        box.problem = reason
        beatSoon()
      },
    })
    served.set(agent.name, { runner, harness: harness.name, box })
    try {
      await runner.start()
      log(`${agent.name}: serving with ${harness.label} in ${settings.folder}`)
    } catch (error) {
      served.delete(agent.name)
      problems.set(agent.name, short(error))
      log(`${agent.name}: could not serve: ${short(error)}`)
      await runner.shutdown().catch(() => undefined)
    }
  }

  async function reconcile(agents: Agent[]): Promise<boolean> {
    let changed = false
    const wanted = new Map(agents.flatMap((agent) => (agent.config && agent.config.machine === machine.id && agent.config.desired === "running" ? [[agent.name, agent]] : [])))
    for (const name of [...served.keys()]) {
      if (wanted.has(name)) continue
      await stopServing(name, "stopped on the board")
      changed = true
    }
    for (const name of [...problems.keys()]) if (!wanted.has(name) && problems.delete(name)) changed = true
    for (const [name, agent] of wanted) {
      const config = agent.config
      if (!config) continue
      const harness = available.find((h) => h.name === config.harness)
      const problem = problemFor(agent, harness)
      const current = served.get(name)
      if (problem || !harness) {
        if (current) await stopServing(name, problem ?? "no harness")
        if (problem && problems.get(name) !== problem) {
          problems.set(name, problem)
          log(`${name}: ${problem}`)
          changed = true
        }
        continue
      }
      if (problems.delete(name)) changed = true
      const settings: AgentSettings = { folder: config.folder, permissions: config.permissions, personality: config.personality, model: config.model }
      if (!current) {
        await serve(agent, harness, settings)
        changed = true
        continue
      }
      if (current.box.problem) {
        current.box.problem = null
        changed = true
      }
      if (!sameSettings(current.box.settings, settings)) {
        current.box.settings = settings
        log(`${name}: settings changed; the next session uses them`)
      }
    }
    return changed
  }

  async function sync(): Promise<void> {
    if (closing) return
    const agents = await beat()
    if (boardDown) return
    if (await reconcile(agents)) await beat()
  }

  const wait = (ms: number) => new Promise<void>((resolve) => void timers.after(ms, resolve))

  async function register(): Promise<void> {
    const body = { id: machine.id, name: machine.name, harnesses: available.map(harnessInfo) }
    let told = false
    for (;;) {
      try {
        await port.register(body)
        return
      } catch (error) {
        if (closing) throw error
        if (!told) log(`runner: waiting for the board (${short(error)})`)
        told = true
        await wait(deps.retryMs ?? 2000)
      }
    }
  }

  return {
    served,
    problems,
    async start(): Promise<readonly Harness[]> {
      available = deps.harnesses.filter((harness) => {
        const probe = harness.probe({ PATH: deps.path })
        if (probe.kind === "missing") log(`runner: ${harness.label} is not available: ${probe.reason}`)
        return probe.kind === "available"
      })
      await register()
      if (deps.onRegistered) await deps.onRegistered(available)
      await enqueue(sync)
      cancel.push(timers.every(machineLimits.heartbeatSeconds * 1000, () => void enqueue(sync)))
      return available
    },
    receive(event: BoardEvent): Promise<void> {
      return enqueue(async () => {
        try {
          if (agentEvents.has(event.type)) await sync()
          else await Promise.all([...served.values()].map((entry) => entry.runner.receive(event)))
        } finally {
          deps.state.set({ ...deps.state.get(), lastSeq: event.seq })
        }
      })
    },
    noteHead(head: number): void {
      if (deps.state.get().lastSeq === null) deps.state.set({ ...deps.state.get(), lastSeq: head })
    },
    async shutdown(): Promise<void> {
      closing = true
      for (const stop of cancel) stop()
      await chain
      await Promise.all([...served.keys()].map((name) => stopServing(name, "the runner is stopping")))
    },
    idle: () => chain,
  }
}

export type Service = ReturnType<typeof createService>
