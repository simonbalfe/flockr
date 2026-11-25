import type { HarnessSettings } from "@earendil-works/pi-durable"
import { memberClient } from "@flockr/client"
import { z } from "zod"
import { agentStateFile, builtInModel, type BuiltInModel } from "../config"
import { failedText } from "../prompt"
import { AgentHome, type TurnOutcome } from "./pi/agent"
import { piBoard, type PiBoard } from "./pi/board"
import { piInstructions } from "./pi/instructions"
import { endpointModels, type ModelSource } from "./pi/model"
import { offeredFileTools, runIdFor } from "./pi/tools"
import type { Harness, HarnessProbe, PermissionCodec, Session, SessionExit, SessionSpec, SessionStatus } from "./types"

const SessionEnv = z.object({ FC_URL: z.url(), FC_AS: z.string().min(1) })

export const maxTurnsPerRun = 40

export interface PiDeps {
  model: () => BuiltInModel
  source: (model: BuiltInModel) => ModelSource
  stateFile: (member: string) => string
  boardFor: (options: { url: string; member: string }) => PiBoard
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
  let source: ModelSource | null = null

  const sourceFor = (model: BuiltInModel): ModelSource => {
    source ??= deps.source(model)
    return source
  }

  function homeFor(options: { url: string; member: string; model: BuiltInModel }): Promise<AgentHome> {
    const known = homes.get(options.member)
    if (known) return known
    const opened = AgentHome.open({
      file: deps.stateFile(options.member),
      member: options.member,
      board: deps.boardFor({ url: options.url, member: options.member }),
      models: sourceFor(options.model).models,
      log: deps.log,
      failedText,
      settings: deps.settings,
    })
    homes.set(options.member, opened)
    opened
      .then((home) => home.recover())
      .then((count) => {
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

  function start(spec: SessionSpec): Session {
    let status: SessionStatus = "running"
    let stopped = false
    const outcomes: Promise<TurnOutcome>[] = []
    const env = SessionEnv.safeParse(spec.env)
    const model = deps.model()
    const folder = spec.folder.trim() ? spec.folder : null
    const fileTools = offeredFileTools(spec.rule)
    const home = env.success ? homeFor({ url: env.data.FC_URL, member: env.data.FC_AS, model }) : Promise.reject(new Error("the session has no board address"))
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
        ),
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
    start,
    home: (member) => homes.get(member),
  }
}

export const piDurable = createPiHarness({
  model: () => builtInModel(),
  source: (model) => endpointModels({ baseUrl: model.baseUrl, key: model.key ?? "", contextWindow: model.contextWindow, maxTokens: model.maxTokens }),
  stateFile: agentStateFile,
  boardFor: ({ url, member }) => piBoard({ member, client: memberClient({ baseUrl: url, member }) }),
  log: (line) => console.log(line),
})
