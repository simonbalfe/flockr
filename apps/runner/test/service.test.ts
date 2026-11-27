import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Agent, AgentConfig, AgentDetail, HeartbeatBody } from "@flockr/client"
import type { MachinePort } from "../src/board"
import { parseConfig } from "../src/config"
import { backupFile, migrateLegacy } from "../src/migrate"
import { createRunner } from "../src/runner"
import { createService, type Spawn } from "../src/service"
import { emptyState, type RunnerState, type SessionMap } from "../src/store"
import { event, fakeBoard, fakeHarness, manualTimers, memoryEpochs, memoryStore, messageThread, task } from "./fakes"

const here = { id: "danas-laptop", name: "danas-laptop" }

function agent(name: string, config: Partial<AgentConfig> = {}): Agent {
  return {
    name,
    kind: "agent",
    owner: "simon",
    runsIn: null,
    source: null,
    state: "idle",
    taskId: null,
    leaseExpiresAt: null,
    status: "offline",
    statusReason: null,
    config: { harness: "fake", harnessLabel: "Fake Agent", folder: `/work/${name}`, machine: here.id, machineName: here.name, permissions: "edit-free-commands-ask", personality: null, model: null, desired: "running", ...config },
  }
}

function fakeMachine(initial: Agent[]) {
  let agents = initial
  const beats: HeartbeatBody[] = []
  const registered: string[] = []
  const created: string[] = []
  let failures = 0
  const port: MachinePort = {
    async register(body) {
      if (failures > 0) {
        failures -= 1
        throw new Error("connection refused")
      }
      registered.push(`${body.id}: ${body.harnesses.map((h) => h.id).join(",")}`)
    },
    async heartbeat(_id, body) {
      beats.push(body)
      return agents
    },
    agent: async (name) => {
      const found = agents.find((a) => a.name === name)
      return found ? { ...found, tasks: [] } : null
    },
    async createAgent(asMember, body) {
      created.push(`${asMember}: ${body.name} ${body.harness} ${body.folder} ${body.machine}`)
      const made: AgentDetail = { ...agent(body.name, { folder: body.folder, harness: body.harness }), tasks: [] }
      agents = [...agents, made]
      return made
    },
  }
  return {
    port,
    beats,
    registered,
    created,
    set: (next: Agent[]) => void (agents = next),
    failRegister: (times: number) => void (failures = times),
    lastReport: () => beats.at(-1)?.agents ?? [],
  }
}

function serviceSetup(options: { agents: Agent[]; folders?: string[]; harnessName?: string }) {
  const machine = fakeMachine(options.agents)
  const { harness, started } = fakeHarness(undefined, options.harnessName ?? "fake")
  const { timers, fire } = manualTimers()
  const board = fakeBoard()
  const logs: string[] = []
  const spawned: string[] = []
  const folders = new Set(options.folders ?? options.agents.map((a) => a.config?.folder ?? ""))
  const sessions = memoryStore<SessionMap>({})
  const service = createService({
    machine: here,
    port: machine.port,
    harnesses: [harness],
    path: "/bin",
    maxSessions: 2,
    folderExists: (folder) => folders.has(folder),
    spawn: (spec: Spawn) => {
      spawned.push(spec.name)
      return createRunner({
        member: spec.name,
        settings: spec.settings,
        channels: {},
        maxSessions: 2,
        maxMinutes: 30,
        harness: spec.harness,
        board: board.port,
        epochs: memoryEpochs(),
        sessions,
        instructions: () => "be brief",
        sessionEnv: {},
        bridge: ({ thread }) => ({ command: "bun", args: [], env: { FLOCKR_THREAD: thread } }),
        log: (line) => void logs.push(line),
        folderExists: (folder) => folders.has(folder),
        hasRoom: spec.hasRoom,
        changed: spec.changed,
        freed: spec.freed,
        problem: spec.problem,
        timers,
      })
    },
    state: memoryStore<RunnerState>(emptyState),
    log: (line) => void logs.push(line),
    timers,
    retryMs: 10,
  })
  return { service, machine, started, board, logs, spawned, folders, fire }
}

const mention = (thread: string, who: string) => event({ type: "message.posted", actor: "simon", messageId: thread, threadId: thread, data: { mentions: [who] } })

describe("the machine service", () => {
  test("on start it registers with the harnesses it can run, serves every running agent assigned here and reports them", async () => {
    const { service, machine, spawned } = serviceSetup({
      agents: [agent("scout"), agent("idle", { desired: "stopped" }), agent("elsewhere", { machine: "tims-laptop" }), { ...agent("joined"), config: null }],
    })
    await service.start()
    expect(machine.registered).toEqual(["danas-laptop: fake"])
    expect(spawned).toEqual(["scout"])
    expect(machine.lastReport()).toEqual([{ name: "scout", state: "serving", reason: null }])
  })

  test("it waits for the board instead of crashing when the board is not up yet", async () => {
    const setup = serviceSetup({ agents: [agent("scout")] })
    setup.machine.failRegister(1)
    const starting = setup.service.start()
    await Bun.sleep(0)
    setup.fire(10)
    await starting
    expect(setup.machine.registered).toHaveLength(1)
    expect(setup.logs.some((l) => l.includes("waiting for the board"))).toBe(true)
  })

  test("a mention reaches only the agent it names, and a stopped agent ignores it", async () => {
    const { service, machine, started, board } = serviceSetup({ agents: [agent("scout"), agent("helper")] })
    await service.start()
    board.threads.set("m10", messageThread("m10", "simon", "@scout hi"))
    await service.receive(mention("m10", "scout"))
    expect(started.map((s) => s.spec.folder)).toEqual(["/work/scout"])
    expect(started[0]?.spec.env).toEqual({})
    machine.set([agent("scout", { desired: "stopped" }), agent("helper")])
    await service.receive(event({ type: "agent.stopped", actor: "simon", data: { name: "scout", machine: here.id } }))
    expect(started[0]?.stopped).toBe(true)
    expect(service.served.has("scout")).toBe(false)
    board.threads.set("m12", messageThread("m12", "simon", "@scout again"))
    await service.receive(mention("m12", "scout"))
    expect(started).toHaveLength(1)
    expect(machine.lastReport()).toEqual([{ name: "helper", state: "serving", reason: null }])
  })

  test("an agent started or created live is served at once", async () => {
    const { service, machine, spawned } = serviceSetup({ agents: [agent("scout", { desired: "stopped" })], folders: ["/work/scout", "/work/fresh"] })
    await service.start()
    expect(spawned).toEqual([])
    machine.set([agent("scout"), agent("fresh")])
    await service.receive(event({ type: "agent.started", actor: "simon", data: { name: "scout" } }))
    expect(spawned).toEqual(["scout", "fresh"])
    expect(machine.lastReport().map((r) => r.name)).toEqual(["scout", "fresh"])
  })

  test("a missing folder or harness is an error with a short reason, not a crash, and clears when fixed", async () => {
    const { service, machine, folders, spawned } = serviceSetup({ agents: [agent("scout"), agent("other", { harness: "elsewhere-agent" })], folders: [] })
    await service.start()
    expect(spawned).toEqual([])
    expect(machine.lastReport()).toEqual([
      { name: "scout", state: "error", reason: "Folder /work/scout not found" },
      { name: "other", state: "error", reason: "Harness elsewhere-agent is not available on danas-laptop" },
    ])
    folders.add("/work/scout")
    machine.set([agent("scout"), agent("other", { harness: "elsewhere-agent" })])
    await service.receive(event({ type: "agent.updated", actor: "simon", data: { name: "scout" } }))
    expect(spawned).toEqual(["scout"])
    expect(machine.lastReport()[0]).toEqual({ name: "scout", state: "serving", reason: null })
  })

  test("a settings change reaches the next session without restarting the agent; working is reported while a run is live", async () => {
    const { service, machine, started, board, spawned } = serviceSetup({ agents: [agent("scout")], folders: ["/work/scout", "/work/next"] })
    await service.start()
    machine.set([agent("scout", { folder: "/work/next", permissions: "read-only" })])
    await service.receive(event({ type: "agent.updated", actor: "simon", data: { name: "scout" } }))
    board.threads.set("m10", messageThread("m10", "simon", "@scout hi"))
    await service.receive(mention("m10", "scout"))
    expect(spawned).toEqual(["scout"])
    expect(started[0]?.spec.folder).toBe("/work/next")
    expect(started[0]?.spec.rule.edit).toBe("deny")
    await service.idle()
    expect(machine.lastReport()).toEqual([{ name: "scout", state: "working", reason: null }])
  })

  test("a paused agent finishes its running run but takes no new work; resuming picks up what waited", async () => {
    const { service, machine, started, board, logs } = serviceSetup({ agents: [agent("claude")] })
    const settle = async () => {
      await Bun.sleep(0)
      await service.receive(event({ type: "board.noticed", actor: "simon" }))
    }
    await service.start()
    board.threads.set("m10", messageThread("m10", "simon", "@claude first"))
    await service.receive(mention("m10", "claude"))
    expect(started).toHaveLength(1)
    machine.set([agent("claude", { desired: "paused" })])
    await service.receive(event({ type: "agent.paused", actor: "simon", data: { name: "claude" } }))
    expect(service.served.has("claude")).toBe(true)
    expect(started[0]?.stopped).toBe(false)
    board.threads.set("m11", messageThread("m11", "simon", "@claude second"))
    await service.receive(mention("m11", "claude"))
    board.tasks.set(5, task({ id: 5 }))
    await service.receive(event({ type: "task.created", actor: "simon", taskId: 5, data: { state: "ready" } }))
    started[0]?.end({ kind: "finished", text: "first answer" })
    await settle()
    expect(started).toHaveLength(1)
    expect(board.calls).toContain("reply m10: first answer")
    expect(board.tasks.get(5)?.state).toBe("ready")
    machine.set([agent("claude")])
    await service.receive(event({ type: "agent.resumed", actor: "simon", data: { name: "claude" } }))
    await settle()
    expect(started.map((s) => s.spec.thread)).toEqual(["m10", "m11", "5"])
    expect(board.tasks.get(5)).toMatchObject({ state: "claimed", holder: "claude" })
    expect(logs.some((l) => l.includes("claude: paused"))).toBe(true)
  })

  test("shutdown stops every served agent's sessions", async () => {
    const { service, started, board } = serviceSetup({ agents: [agent("scout")] })
    await service.start()
    board.threads.set("m10", messageThread("m10", "simon", "@scout hi"))
    await service.receive(mention("m10", "scout"))
    await service.shutdown()
    expect(started[0]?.stopped).toBe(true)
    expect(service.served.size).toBe(0)
  })
})

describe("moving an old one-member config", () => {
  test("the member becomes an agent on this machine, the file keeps everything else, the old file is kept and sessions are rekeyed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "flockr-migrate-"))
    const file = path.join(dir, "runner.json")
    const old = { board: "http://localhost:5173", member: "claude", harness: "fake", channels: { general: dir }, maxSessions: 3, maxMinutes: 20 }
    writeFileSync(file, JSON.stringify(old))
    const machine = fakeMachine([{ ...agent("claude"), config: null }])
    const sessions = memoryStore<SessionMap>({ m10: { harness: "fake", id: "s1" } })
    const { harness } = fakeHarness()
    const config = parseConfig(old)
    const moved = await migrateLegacy({ file, config, legacy: { member: "claude", harness: "fake" }, machine: here, available: [harness], port: machine.port, sessions, log: () => undefined })
    expect(moved).toBe(true)
    expect(machine.created).toEqual([`simon: claude fake ${dir} danas-laptop`])
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ board: "http://localhost:5173", channels: { general: dir }, maxSessions: 3, maxMinutes: 20, saveSessions: false })
    expect(JSON.parse(readFileSync(backupFile(file), "utf8"))).toEqual(old)
    expect(sessions.value()).toEqual({ "claude:m10": { harness: "fake", id: "s1" } })
    const unavailable = await migrateLegacy({ file, config, legacy: { member: "claude", harness: "missing" }, machine: here, available: [harness], port: machine.port, sessions, log: () => undefined })
    expect(unavailable).toBe(false)
    expect(existsSync(file)).toBe(true)
  })
})
