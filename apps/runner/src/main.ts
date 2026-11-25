import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { connectLive, memberClient } from "@flockr/client"
import { epochStore } from "@flockr/cli/epochs"
import { boardClient, machineClient } from "./board"
import {
  bridgeEntry,
  bunBinary,
  claimsFile,
  cliEntry,
  cliNames,
  configFile,
  ConfigError,
  inherited,
  inheritedPath,
  isFolder,
  legacyAgent,
  loadConfig,
  machineIdentity,
  quiet,
  sessionsFile,
  shimDir,
  skillFile,
  stateFile,
  type RunnerConfig,
} from "./config"
import { harnesses } from "./harness/registry"
import { migrateLegacy } from "./migrate"
import { instructions } from "./prompt"
import { createRunner } from "./runner"
import { createService, type Spawn } from "./service"
import { emptyState, jsonStore, RunnerState, SessionMap } from "./store"

function writeShims(): void {
  mkdirSync(shimDir, { recursive: true })
  for (const name of cliNames) {
    const shim = path.join(shimDir, name)
    writeFileSync(shim, `#!/bin/sh\nexec "${bunBinary}" "${cliEntry}" "$@"\n`)
    chmodSync(shim, 0o755)
  }
}

function readConfig(): RunnerConfig {
  try {
    return loadConfig(configFile)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`runner config: ${error.message}`)
      process.exit(1)
    }
    throw error
  }
}

const config = readConfig()

const board = config.board
const machine = machineIdentity(config)
const sessionPath = `${shimDir}:${inheritedPath}`
const skill = readFileSync(skillFile, "utf8")
const sessions = jsonStore(sessionsFile, SessionMap, {})
const state = jsonStore(stateFile, RunnerState, emptyState)
const clients = new Map<string, ReturnType<typeof memberClient>>()
const clientFor = (member: string) => {
  const found = clients.get(member) ?? memberClient({ baseUrl: board, member })
  clients.set(member, found)
  return found
}
const log = (line: string) => console.log(quiet ? line : `${new Date().toTimeString().slice(0, 8)} ${line}`)
writeShims()

function spawn(spec: Spawn) {
  const fcEnv = { FC_URL: board, FC_AS: spec.name, FC_STATE: claimsFile }
  return createRunner({
    member: spec.name,
    settings: spec.settings,
    channels: config.channels,
    maxSessions: config.maxSessions,
    maxMinutes: config.maxMinutes,
    harness: spec.harness,
    board: boardClient({ member: spec.name, client: clientFor(spec.name) }),
    epochs: epochStore({ file: claimsFile, url: board, member: spec.name }),
    sessions,
    instructions: (settings) => instructions({ member: spec.name, skill, permissions: settings.permissions, personality: settings.personality }),
    sessionEnv: { ...inherited(spec.harness.passEnv), ...fcEnv, PATH: sessionPath },
    bridge: (thread, settings) => ({
      command: bunBinary,
      args: [bridgeEntry],
      env: { ...inherited(["HOME", "TMPDIR"]), ...fcEnv, PATH: inheritedPath, FLOCKR_THREAD: thread, FLOCKR_HARNESS: spec.harness.name, FLOCKR_PERMISSIONS: settings.permissions },
    }),
    log,
    hasRoom: spec.hasRoom,
    changed: spec.changed,
    freed: spec.freed,
    problem: spec.problem,
  })
}

const port = machineClient({ client: memberClient({ baseUrl: board }), forMember: clientFor })
const legacy = legacyAgent(config)
const service = createService({
  machine,
  port,
  harnesses,
  path: sessionPath,
  maxSessions: config.maxSessions,
  folderExists: isFolder,
  spawn,
  state,
  log,
  onRegistered: async (available) => {
    if (!legacy) return
    await migrateLegacy({ file: configFile, config, legacy, machine, available, port, sessions, log }).catch((error: unknown) =>
      log(`runner: could not move ${legacy.member} out of ${configFile}: ${error instanceof Error ? error.message : String(error)}`),
    )
  },
})

log(`runner: machine ${machine.name} (${machine.id}) on ${board}, up to ${config.maxSessions} sessions`)

let live: { close: () => void } | null = null
let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  log("runner: stopping sessions and releasing claims")
  live?.close()
  await service.shutdown()
  process.exit(0)
}
process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

const available = await service.start()
log(`runner: ready with ${available.length ? available.map((h) => `${h.label} (${h.name})`).join(", ") : "no harness"}; serving ${service.served.size} agent${service.served.size === 1 ? "" : "s"}`)

live = connectLive({
  baseUrl: board,
  since: state.get().lastSeq,
  onHello: (head) => service.noteHead(head),
  onStatus: (up) => {
    if (!up && !stopping) log("runner: board connection lost, reconnecting")
  },
  onEvent: (event) => void service.receive(event),
})
