import type { HarnessSettings } from "@earendil-works/pi-durable"
import { memberClient } from "@flockr/client"
import { z } from "zod"
import { agentStateFile, builtInModel, type BuiltInModel } from "../config"
import { failedText } from "../prompt"
import { AgentHome, type TurnOutcome } from "./pi/agent"
import { piBoard, type PiBoard } from "./pi/board"
import { hasPiState, rebuildPiState, takePiChunk } from "./pi/chunks"
import { piInstructions } from "./pi/instructions"
import { endpointModels, type ModelSource } from "./pi/model"
import { offeredFileTools, runIdFor } from "./pi/tools"
import type { Harness, HarnessProbe, PermissionCodec, Session, SessionExit, SessionPlace, SessionSaver, SessionSpec, SessionStatus } from "./types"

const SessionEnv = z.object({ FC_URL: z.url(), FC_AS: z.string().min(1), FLOCKR_KEY: z.string().min(1).optional() })

export const maxTurnsPerRun = 40

export const piSession: Omit<SessionPlace, "claim"> = { session: "agent", thread: null }

export const ledgerFile = (stateFile: string) => `${stateFile}.chunks.json`

export interface PiDeps {
  model: () => BuiltInModel
  source: (model: BuiltInModel) => ModelSource
  stateFile: (member: string) => string
  boardFor: (options: { url: string; member: string; key: string | null }) => PiBoard
  log: (line: string) => void
  settings?: HarnessSettings
}

const noBridge: PermissionCodec = {
  read: () => null,
  allow: () => ({ behavior: "allow" }),
  deny: (message) => ({ behavior: "deny", message }),
}

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 300)

export function createPiHarness(deps: PiDeps): Harness & { home: (member: string) => Promise<AgentHome> | undefined } {
  const homes = new Map<string, Promise<AgentHome>>()
  const savers = new Map<string, SessionSaver>()
  const saving = new Map<string, Promise<void>>()
  let source: ModelSource | null = null

  const sourceFor = (model: BuiltInModel): ModelSource => {
    source ??= deps.source(model)
    return source
  }

  const place: SessionPlace = { ...piSession, claim: null }

  async function restoreHome(file: string, saver: SessionSaver | null): Promise<void> {
    if (!saver || hasPiState(file)) return
    const chunks = await saver.restore(place)
    await rebuildPiState({ file, ledger: ledgerFile(file), chunks })
  }

  function saveHome(member: string): Promise<void> {
    const saver = savers.get(member)
    if (!saver) return Promise.resolve()
    const file = deps.stateFile(member)
    const work = (saving.get(member) ?? Promise.resolve())
      .then(async () => {
        const taken = takePiChunk({ file, ledger: ledgerFile(file) })
        if (!taken) return
        if (await saver.save(place, { data: taken.data, cursor: null })) taken.commit()
      })
      .catch((error: unknown) => deps.log(`${member}: could not save the session: ${short(error)}`))
    saving.set(member, work)
    return work
  }

  function homeFor(options: { url: string; member: string; key: string | null; model: BuiltInModel; saver: SessionSaver | null }): Promise<AgentHome> {
    const known = homes.get(options.member)
    if (known) return known
    if (options.saver) savers.set(options.member, options.saver)
    const file = deps.stateFile(options.member)
    const opened = restoreHome(file, options.saver).then(() =>
      AgentHome.open({
        file,
        member: options.member,
        board: deps.boardFor({ url: options.url, member: options.member, key: options.key }),
        models: sourceFor(options.model).models,
        log: deps.log,
        failedText,
        settings: deps.settings,
      }),
    )
    homes.set(options.member, opened)
    opened
      .then((home) => home.recover())
      .then((count) => {
        void saveHome(options.member)
        if (count) deps.log(`${options.member}: resumed ${count} unfinished turn${count === 1 ? "" : "s"}`)
      })
      .catch((error: unknown) => {
        homes.delete(options.member)
        deps.log(`${options.member}: built-in agent could not open its state: ${short(error)}`)
      })
    return opened
  }

  function probe(): HarnessProbe {
    const model = deps.model()
    if (model.problem) return { kind: "missing", reason: model.problem }
    return model.key ? { kind: "available" } : { kind: "missing", reason: "no model key" }
  }

  function homeForSpec(spec: SessionSpec, model: BuiltInModel): Promise<AgentHome> {
    const env = SessionEnv.safeParse(spec.env)
    if (!env.success) return Promise.reject(new Error("the session has no board address"))
    return homeFor({ url: env.data.FC_URL, member: env.data.FC_AS, key: env.data.FLOCKR_KEY ?? null, model, saver: spec.saver })
  }

  function start(spec: SessionSpec): Session {
    let status: SessionStatus = "running"
    let stopped = false
    const outcomes: Promise<TurnOutcome>[] = []
    const env = SessionEnv.safeParse(spec.env)
    const model = deps.model()
    const folder = spec.folder.trim() ? spec.folder : null
    const fileTools = offeredFileTools(spec.rule)
    const home = homeForSpec(spec, model)
    const member = env.data?.FC_AS ?? null
    const saved = async (outcome: TurnOutcome): Promise<TurnOutcome> => {
      if (member) await saveHome(member)
      return outcome
    }
    const modelId = spec.model ?? model.defaultModel

    const ask = (prompt: string) =>
      outcomes.push(
        home.then((agent) =>
          agent.turn({
            thread: spec.thread,
            prompt,
            settings: {
              model: model.key && modelId ? sourceFor(model).ref(modelId) : null,
              instructions: piInstructions({ member: env.data?.FC_AS ?? "agent", personality: spec.personality, folder, fileTools: fileTools.map((t) => t.name) }),
              folder,
              fileTools,
              maxTurns: maxTurnsPerRun,
            },
          }),
        ).then(saved),
      )

    ask(spec.prompt)

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
        ask(text)
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

  return {
    name: "pi-durable",
    label: "Built-in agent",
    capabilities: { resume: true, streaming: true },
    probe,
    passEnv: [],
    permissions: noBridge,
    chunks: { saving: "always", ready: async (spec) => void (await homeForSpec(spec, deps.model())) },
    start,
    home: (member) => homes.get(member),
  }
}

export const piDurable = createPiHarness({
  model: () => builtInModel(),
  source: (model) => endpointModels({ baseUrl: model.baseUrl, key: model.key ?? "", contextWindow: model.contextWindow, maxTokens: model.maxTokens }),
  stateFile: agentStateFile,
  boardFor: ({ url, member, key }) => piBoard({ member, client: memberClient({ baseUrl: url, member, key }) }),
  log: (line) => console.log(line),
})
