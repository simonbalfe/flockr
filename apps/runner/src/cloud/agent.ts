import type { SqliteDatabase } from "@earendil-works/chord/sqlite"
import type { HarnessSettings } from "@earendil-works/pi-durable"
import * as sdk from "@flockr/client"
import { memberClient } from "@flockr/client"
import type { EpochStore } from "@flockr/cli/epochs"
import { sandboxWorkspace } from "@flockr/sandbox/sandbox"
import { z } from "zod"
import { boardClient, call, sessionsClient, type MachinePort } from "../board"
import { createPiHarness, piDurableInfo, type PiModel } from "../harness/pi-durable"
import type { HostWakes } from "../harness/pi/agent"
import { fencedPiBoard } from "../harness/pi/board"
import { databaseState, hostState } from "../harness/pi/database-store"
import { endpointModels } from "../harness/pi/model"
import { createRunner, realTimers, type Timers } from "../runner"
import { createService } from "../service"
import { SessionMap, type JsonStore, type RunnerState } from "../store"
import { boxPool, type BoxPlan } from "./boxes"
import { directSaver } from "./saver"

export interface CloudModel {
  baseUrl: string
  fetch: typeof fetch
  defaultModel: string | null
  known: readonly string[]
  problem: string | null
  contextWindow: number
  maxTokens: number
}

export interface CloudAgentDeps {
  member: string
  machine: { id: string; name: string }
  board: { baseUrl: string; fetch: typeof fetch }
  model: CloudModel
  database: SqliteDatabase
  port: MachinePort
  log: (line: string) => void
  wakes?: HostWakes
  timers?: Timers
  settings?: HarnessSettings
  maxSessions?: number
  maxMinutes?: number
  boxes?: BoxPlan | null
}

export const cloudLimits = { maxSessions: 4, maxMinutes: 30, eventPage: 200 } as const

export const proxiedModelKey = "board-proxy"

const stateKeys = { cursor: "cursor", sessions: "sessions" } as const

const Cursor = z.coerce.number().int().min(0)

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200)

function memoryEpochs(): EpochStore {
  const all = new Map<number, number>()
  return { get: (id) => all.get(id), set: (id, epoch) => void all.set(id, epoch), clear: (id) => void all.delete(id) }
}

function memoryState(): JsonStore<RunnerState> {
  let value: RunnerState = { lastSeq: null }
  return { get: () => value, set: (next) => void (value = next) }
}

export function createCloudAgent(deps: CloudAgentDeps) {
  const { member, log } = deps
  const timers = deps.timers ?? realTimers
  const state = hostState(deps.database)
  const client = memberClient({ baseUrl: deps.board.baseUrl, member, fetch: deps.board.fetch })
  const saver = directSaver({ board: sessionsClient({ member, client }), log })
  const boxes = deps.boxes ? boxPool({ plan: deps.boxes, state, member, log }) : null
  const piModel: PiModel = { defaultModel: deps.model.defaultModel, known: deps.model.known, key: deps.model.problem ? null : proxiedModelKey, problem: deps.model.problem }

  const pi = createPiHarness({
    model: () => piModel,
    source: () => endpointModels({ baseUrl: deps.model.baseUrl, key: proxiedModelKey, contextWindow: deps.model.contextWindow, maxTokens: deps.model.maxTokens, fetch: deps.model.fetch }),
    store: () => databaseState(deps.database),
    boardFor: () => fencedPiBoard({ member, clientFor: (channels) => memberClient({ baseUrl: deps.board.baseUrl, member, channels, fetch: deps.board.fetch }) }),
    workspace: boxes ? { kind: "box", cwd: sandboxWorkspace, env: (thread) => boxes.envFor(thread) } : null,
    log,
    settings: deps.settings,
    wakes: deps.wakes,
  })

  let sessions: SessionMap = {}
  const sessionStore: JsonStore<SessionMap> = {
    get: () => sessions,
    set(next) {
      sessions = next
      state.write(stateKeys.sessions, JSON.stringify(next)).catch((error: unknown) => log(`${member}: could not keep its session list: ${short(error)}`))
    },
  }

  const service = createService({
    machine: deps.machine,
    port: deps.port,
    harnesses: [pi],
    path: "",
    maxSessions: deps.maxSessions ?? cloudLimits.maxSessions,
    folderExists: () => true,
    timers,
    state: memoryState(),
    log,
    spawn: (spec) =>
      createRunner({
        member: spec.name,
        settings: spec.settings,
        channels: {},
        maxSessions: deps.maxSessions ?? cloudLimits.maxSessions,
        maxMinutes: deps.maxMinutes ?? cloudLimits.maxMinutes,
        folderExists: () => true,
        harness: spec.harness,
        board: boardClient({ member: spec.name, client }),
        epochs: memoryEpochs(),
        sessions: sessionStore,
        instructions: () => "",
        sessionEnv: { FC_URL: deps.board.baseUrl, FC_AS: spec.name },
        bridge: () => ({ command: "", args: [], env: {} }),
        log,
        timers,
        hasRoom: spec.hasRoom,
        changed: spec.changed,
        freed: spec.freed,
        problem: spec.problem,
        saver,
      }),
  })

  async function readCursor(): Promise<number | null> {
    const raw = await state.read(stateKeys.cursor)
    return raw === null ? null : (Cursor.safeParse(raw).data ?? null)
  }

  async function startFromNow(): Promise<void> {
    if ((await readCursor()) !== null) return
    const page = await call(sdk.listEvents({ client, query: { since: 0, limit: 1 } }))
    await state.write(stateKeys.cursor, String(page.head))
  }

  async function feed(): Promise<void> {
    const kept = await readCursor()
    if (kept === null) return
    let cursor: number = kept
    for (;;) {
      const page = await call(sdk.listEvents({ client, query: { since: cursor, limit: cloudLimits.eventPage } }))
      for (const event of page.events) {
        await service.receive(event)
        await boxes?.receive(event)
      }
      if (page.through > cursor) await state.write(stateKeys.cursor, String(page.through))
      if (page.through <= cursor || page.through >= page.head) return
      cursor = page.through
    }
  }

  let started: Promise<void> | null = null
  let feeding: Promise<void> | null = null
  let again = false

  async function begin(): Promise<void> {
    const raw = await state.read(stateKeys.sessions)
    sessions = raw === null ? {} : (SessionMap.safeParse(JSON.parse(raw)).data ?? {})
    await startFromNow()
    await pi.open({ url: deps.board.baseUrl, member, key: null, saver })
    await service.start()
    await feed()
  }

  const start = (): Promise<void> => {
    started ??= begin().catch((error: unknown) => {
      started = null
      throw error
    })
    return started
  }

  async function poke(): Promise<void> {
    await start()
    if (feeding) {
      again = true
      return feeding
    }
    feeding = (async () => {
      do {
        again = false
        await feed().catch((error: unknown) => log(`${member}: could not read the board's events: ${short(error)}`))
      } while (again)
    })().finally(() => (feeding = null))
    return feeding
  }

  return {
    start,
    poke,
    async alarm(): Promise<void> {
      await start()
      await (await pi.home(member))?.alarm()
      await poke()
    },
    idle: async (): Promise<void> => {
      await feeding
      await service.idle()
    },
    async close(): Promise<void> {
      await service.shutdown()
      await (await pi.home(member))?.close()
    },
    pi,
    boxes,
  }
}

export type CloudAgent = ReturnType<typeof createCloudAgent>

export const cloudHarness = { id: piDurableInfo.name, label: piDurableInfo.label, capabilities: { ...piDurableInfo.capabilities } }
