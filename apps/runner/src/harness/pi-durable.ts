import type { HarnessSettings } from "@earendil-works/pi-durable"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { z } from "zod"
import { fenceEnv } from "../limits"
import { failedText } from "../prompt"
import { AgentHome, type HostWakes, type TurnOutcome, type WhenBusy } from "./pi/agent"
import type { FencedBoard } from "./pi/board"
import { piInstructions } from "./pi/instructions"
import type { ModelSource } from "./pi/model"
import type { PiStore } from "./pi/store"
import { offeredFileTools, runIdFor } from "./pi/tools"
import type { Harness, HarnessProbe, PermissionCodec, Session, SessionExit, SessionPlace, SessionSaver, SessionSpec, SessionStatus } from "./types"

const SessionEnv = z.object({ FC_URL: z.url(), FC_AS: z.string().min(1), FLOCKR_KEY: z.string().min(1).optional(), [fenceEnv]: z.string().min(1).optional() })

export const maxTurnsPerRun = 40

export const piDurableInfo = { name: "pi-durable", label: "Built-in agent", capabilities: { resume: true, streaming: true } } as const

export const piSession: Omit<SessionPlace, "claim"> = { session: "agent", thread: null }

export interface PiModel {
  defaultModel: string | null
  key: string | null
  problem: string | null
  known?: readonly string[]
}

export interface PiDeps {
  model: () => PiModel
  source: () => ModelSource
  store: PiStore
  boardFor: (options: { url: string; member: string; key: string | null }) => FencedBoard
  workspace: ((cwd: string) => ExecutionEnv) | null
  log: (line: string) => void
  settings?: HarnessSettings
  wakes?: HostWakes
}

export interface HomeAddress {
  url: string
  member: string
  key: string | null
  saver: SessionSaver | null
}

const noBridge: PermissionCodec = {
  read: () => null,
  allow: () => ({ behavior: "allow" }),
  deny: (message) => ({ behavior: "deny", message }),
}

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 300)

export function createPiHarness(deps: PiDeps) {
  const homes = new Map<string, Promise<AgentHome>>()
  const savers = new Map<string, SessionSaver>()
  const saving = new Map<string, Promise<void>>()
  let source: ModelSource | null = null

  const sourceFor = (): ModelSource => {
    source ??= deps.source()
    return source
  }

  const place: SessionPlace = { ...piSession, claim: null }

  async function restoreHome(member: string, saver: SessionSaver | null): Promise<void> {
    const state = deps.store(member)
    if (!saver || (await state.hasState())) return
    await state.rebuild(await saver.restore(place))
  }

  function saveHome(member: string): Promise<void> {
    const saver = savers.get(member)
    if (!saver) return Promise.resolve()
    const work = (saving.get(member) ?? Promise.resolve())
      .then(async () => {
        const taken = await deps.store(member).take()
        if (!taken) return
        if (await saver.save(place, { data: taken.data, cursor: null })) await taken.commit()
      })
      .catch((error: unknown) => deps.log(`${member}: could not save the session: ${short(error)}`))
    saving.set(member, work)
    return work
  }

  function homeFor(address: HomeAddress): Promise<AgentHome> {
    const known = homes.get(address.member)
    if (known) return known
    if (address.saver) savers.set(address.member, address.saver)
    const opened = restoreHome(address.member, address.saver).then(async () => {
      const model = deps.model()
      for (const id of new Set([...(model.defaultModel ? [model.defaultModel] : []), ...(model.known ?? [])])) sourceFor().ref(id)
      return AgentHome.open({
        storage: await deps.store(address.member).open(),
        member: address.member,
        board: deps.boardFor({ url: address.url, member: address.member, key: address.key }),
        workspace: deps.workspace,
        models: sourceFor().models,
        log: deps.log,
        failedText,
        settings: deps.settings,
        wakes: deps.wakes,
      })
    })
    homes.set(address.member, opened)
    opened
      .then((home) => home.recover())
      .then((count) => {
        void saveHome(address.member)
        if (count) deps.log(`${address.member}: resumed ${count} unfinished turn${count === 1 ? "" : "s"}`)
      })
      .catch((error: unknown) => {
        homes.delete(address.member)
        deps.log(`${address.member}: built-in agent could not open its state: ${short(error)}`)
      })
    return opened
  }

  function probe(): HarnessProbe {
    const model = deps.model()
    if (model.problem) return { kind: "missing", reason: model.problem }
    return model.key ? { kind: "available" } : { kind: "missing", reason: "no model key" }
  }

  function homeForSpec(spec: SessionSpec): Promise<AgentHome> {
    const env = SessionEnv.safeParse(spec.env)
    if (!env.success) return Promise.reject(new Error("the session has no board address"))
    return homeFor({ url: env.data.FC_URL, member: env.data.FC_AS, key: env.data.FLOCKR_KEY ?? null, saver: spec.saver })
  }

  function start(spec: SessionSpec): Session {
    let status: SessionStatus = "running"
    let stopped = false
    const outcomes: Promise<TurnOutcome>[] = []
    const env = SessionEnv.safeParse(spec.env)
    const model = deps.model()
    const folder = spec.folder.trim() && deps.workspace ? spec.folder : null
    const channel = env.data?.[fenceEnv] ?? null
    const fileTools = offeredFileTools(spec.rule)
    const home = homeForSpec(spec)
    const member = env.data?.FC_AS ?? null
    const saved = async (outcome: TurnOutcome): Promise<TurnOutcome> => {
      if (member) await saveHome(member)
      return outcome
    }
    const modelId = spec.model ?? model.defaultModel

    const ask = (prompt: string, whenBusy: WhenBusy) =>
      outcomes.push(
        home
          .then((agent) =>
            agent.turn({
              thread: spec.thread,
              prompt,
              whenBusy,
              settings: {
                model: model.key && modelId ? sourceFor().ref(modelId) : null,
                instructions: piInstructions({ member: env.data?.FC_AS ?? "agent", personality: spec.personality, folder, fileTools: fileTools.map((t) => t.name) }),
                folder,
                channel,
                fileTools,
                maxTurns: maxTurnsPerRun,
              },
            }),
          )
          .then(saved),
      )

    ask(spec.prompt, "followUp")

    const exit = (async (): Promise<SessionExit> => {
      const results: TurnOutcome[] = []
      for (let seen = 0; seen < outcomes.length; seen += 1) {
        const outcome = outcomes[seen]
        if (outcome) results.push(await outcome.catch((error: unknown): TurnOutcome => ({ kind: "unanswered", reason: short(error), aborted: false })))
      }
      status = "exited"
      if (stopped) return { kind: "stopped" }
      const failed = results.flatMap((r) => (r.kind === "unanswered" ? [r.reason] : []))
      return failed[0] === undefined ? { kind: "finished", text: "" } : { kind: "failed", error: failed[0] }
    })()

    return {
      id: runIdFor(spec.thread),
      exit,
      send(text) {
        if (status === "exited" || stopped) return false
        ask(text, "steer")
        return true
      },
      stop() {
        if (status === "exited" || stopped) return
        stopped = true
        home.then((agent) => agent.abort(spec.thread)).catch((error: unknown) => deps.log(`could not stop the run in ${spec.thread}: ${short(error)}`))
      },
      status: () => status,
    }
  }

  const harness: Harness = {
    ...piDurableInfo,
    capabilities: { ...piDurableInfo.capabilities },
    probe,
    passEnv: [],
    permissions: noBridge,
    chunks: { saving: "always", ready: async (spec) => void (await homeForSpec(spec)) },
    start,
  }

  return Object.assign(harness, { home: (member: string) => homes.get(member), open: homeFor })
}

export type PiHarness = ReturnType<typeof createPiHarness>
