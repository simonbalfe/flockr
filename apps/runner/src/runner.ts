import type { BoardEvent, RunEndStatus, Task, Thread } from "@flockr/client"
import type { AgentPermissions } from "@flockr/contracts/agents"
import type { EpochStore } from "@flockr/cli/epochs"
import { activitySink, type ActivitySink } from "./activity"
import type { BoardPort, Claim } from "./board"
import { folderFor, isFolder, leaseRenewMs } from "./config"
import type { Harness, PermissionBridge, Session, SessionExit } from "./harness/types"
import { ruleFor } from "./permissions"
import { conversationPrompt, failedText, followUpPrompt, missingFolderText, resumeWorkPrompt, stoppedText, timeLimitText, workPrompt } from "./prompt"
import { claimable, eventData, eventTypes, holds, isTaskEvent, routeReply, startsConversation, waitsFor } from "./routing"
import { sessionKey, type JsonStore, type SessionMap } from "./store"

const exitStatus = { finished: "ok", failed: "error", stopped: "stopped" } as const satisfies Record<SessionExit["kind"], RunEndStatus>

export interface Timers {
  after: (ms: number, run: () => void) => () => void
  every: (ms: number, run: () => void) => () => void
}

export const realTimers: Timers = {
  after(ms, run) {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
  every(ms, run) {
    const timer = setInterval(run, ms)
    return () => clearInterval(timer)
  },
}

export interface BridgePlace {
  thread: string
  channel: string
}

export interface AgentSettings {
  folder: string
  permissions: AgentPermissions
  personality: string | null
  model: string | null
}

export interface RunnerDeps {
  member: string
  settings: () => AgentSettings
  channels: Record<string, string>
  maxSessions: number
  maxMinutes: number
  harness: Harness
  board: BoardPort
  epochs: EpochStore
  sessions: JsonStore<SessionMap>
  instructions: (settings: AgentSettings) => string
  sessionEnv: Record<string, string>
  bridge: (place: BridgePlace, settings: AgentSettings) => PermissionBridge
  log: (line: string) => void
  timers?: Timers
  folderExists?: (folder: string) => boolean
  hasRoom?: () => boolean
  changed?: () => void
  freed?: () => void
  problem?: (reason: string) => void
  showRun?: (run: { thread: string; folder: string }) => void
}

type Purpose = "work" | "talk"
type StopReason = "lost" | "time" | "shutdown" | "asked"

interface Run {
  thread: string
  channel: string
  purpose: Purpose
  claim: Claim | null
  session: Session
  stopping: StopReason | null
  pending: string[]
  cancel: (() => void)[]
  entry: Promise<string | null>
  activity: ActivitySink
  done: Promise<void>
}

interface Launch {
  thread: string
  channel: string
  purpose: Purpose
  claim: Claim | null
  prompt: (resuming: boolean) => string
}

export function createRunner(deps: RunnerDeps) {
  const { member, harness, board, epochs, log } = deps
  const maxMinutes = deps.maxMinutes
  const timers = deps.timers ?? realTimers
  const folderExists = deps.folderExists ?? isFolder
  const runs = new Map<string, Run>()
  const toldMissing = new Set<string>()
  const queued = new Map<string, { channel: string; texts: string[] }>()
  let chain: Promise<void> = Promise.resolve()
  let closing = false

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const next = chain.then(job).catch((error: unknown) => log(`error: ${error instanceof Error ? error.message : String(error)}`))
    chain = next
    return next
  }

  const hasRoom = deps.hasRoom ?? (() => runs.size < deps.maxSessions)
  const keyOf = (thread: string) => sessionKey(member, thread)

  const storedSession = (thread: string): string | null => {
    if (!harness.capabilities.resume) return null
    const stored = deps.sessions.get()[keyOf(thread)]
    return stored && stored.harness === harness.name ? stored.id : null
  }

  async function folderOrNotice(thread: string, channel: string): Promise<string | null> {
    const folder = folderFor(deps, channel) ?? deps.settings().folder
    if (folderExists(folder)) return folder
    deps.problem?.(`Folder ${folder} not found`)
    if (toldMissing.has(thread)) return null
    toldMissing.add(thread)
    await board.reply(thread, missingFolderText(folder))
    log(`${member}: folder ${folder} not found, told thread ${thread}`)
    return null
  }

  function launch(spec: Launch, folder: string): void {
    const resumeId = storedSession(spec.thread)
    const settings = deps.settings()
    let entryFound: (entry: Promise<string | null>) => void = () => undefined
    const entry = new Promise<string | null>((resolve) => (entryFound = resolve))
    const activity = activitySink({ entry, send: board.updateEntry, after: timers.after, log })
    const session = harness.start({
      title: `flockr ${member} ${spec.thread}`,
      prompt: spec.prompt(resumeId !== null),
      instructions: deps.instructions(settings),
      folder,
      env: deps.sessionEnv,
      resumeId,
      bridge: deps.bridge({ thread: spec.thread, channel: spec.channel }, settings),
      timeLimitMs: maxMinutes * 60_000,
      rule: ruleFor(settings.permissions),
      thread: spec.thread,
      personality: settings.personality,
      model: settings.model,
      activity: activity.push,
    })
    deps.sessions.set({ ...deps.sessions.get(), [keyOf(spec.thread)]: { harness: harness.name, id: session.id } })
    let finished: () => void = () => undefined
    const run: Run = {
      thread: spec.thread,
      channel: spec.channel,
      purpose: spec.purpose,
      claim: spec.claim,
      session,
      stopping: null,
      pending: [],
      cancel: [],
      entry,
      activity,
      done: new Promise((resolve) => (finished = resolve)),
    }
    entryFound(
      board
        .startEntry(spec.thread, { title: spec.purpose === "work" ? `Working on #${spec.thread}` : "Answering", runId: session.id, key: `${session.id}-${Date.now()}` })
        .catch((error: unknown) => {
          log(`could not post the activity entry in ${spec.thread}: ${error instanceof Error ? error.message : String(error)}`)
          return null
        }),
    )
    runs.set(spec.thread, run)
    deps.changed?.()
    deps.showRun?.({ thread: spec.thread, folder })
    log(`${member}: start ${spec.purpose} in ${spec.thread} (#${spec.channel}) in ${folder}${resumeId ? `, resuming ${resumeId}` : ""}`)
    run.cancel.push(timers.after(maxMinutes * 60_000, () => void enqueue(async () => stop(run, "time"))))
    const claim = spec.claim
    if (claim) {
      run.cancel.push(
        timers.every(leaseRenewMs, () =>
          void enqueue(async () => {
            if (runs.get(run.thread) !== run || run.stopping) return
            if (!(await board.renew(claim))) stop(run, "lost")
          }),
        ),
      )
    }
    session.exit
      .then((exit) => enqueue(() => finish(run, exit)))
      .catch((error: unknown) => log(`error: ${String(error)}`))
      .finally(finished)
  }

  function stop(run: Run, reason: StopReason): void {
    if (run.stopping) return
    run.stopping = reason
    log(`${member}: stop ${run.thread}: ${reason}`)
    run.session.stop()
  }

  async function stillHeld(claim: Claim): Promise<boolean> {
    return holds(await board.task(claim.taskId), member, claim.epoch)
  }

  async function afterStop(run: Run, reason: StopReason): Promise<void> {
    switch (reason) {
      case "time":
        await board.reply(run.thread, timeLimitText(maxMinutes))
        if (run.claim) await board.release(run.claim, false)
        return
      case "shutdown":
        if (run.claim) await board.release(run.claim, true)
        return
      case "lost":
        return
      case "asked":
        if (run.claim && run.purpose === "work") await board.block(run.claim, stoppedText)
        return
      default: {
        const never: never = reason
        throw new Error(`Unknown stop reason ${String(never)}`)
      }
    }
  }

  async function afterExit(run: Run, exit: SessionExit): Promise<void> {
    switch (exit.kind) {
      case "finished": {
        const text = exit.text.trim()
        if (run.purpose === "work" && run.claim) {
          if (await stillHeld(run.claim)) await board.submit(run.claim, text || "Done.")
          return
        }
        if (text) await board.reply(run.thread, text)
        return
      }
      case "failed":
      case "stopped": {
        const error = exit.kind === "failed" ? exit.error : "the session was stopped from outside the runner"
        if (run.purpose === "work" && run.claim && (await stillHeld(run.claim))) await board.block(run.claim, failedText(error))
        else await board.reply(run.thread, failedText(error))
        return
      }
      default: {
        const never: never = exit
        throw new Error(`Unknown exit ${JSON.stringify(never)}`)
      }
    }
  }

  function endStatus(run: Run, exit: SessionExit): RunEndStatus {
    if (run.stopping) return "stopped"
    return exitStatus[exit.kind]
  }

  async function finish(run: Run, exit: SessionExit): Promise<void> {
    for (const cancel of run.cancel) cancel()
    runs.delete(run.thread)
    deps.changed?.()
    await run.activity.flush()
    const entryId = await run.entry
    if (entryId) await board.finishEntry(entryId, endStatus(run, exit)).catch(() => undefined)
    log(`${member}: end ${run.thread}: ${run.stopping ?? exit.kind}`)
    if (run.stopping) await afterStop(run, run.stopping)
    else await afterExit(run, exit)
    if (run.pending.length && run.stopping !== "shutdown" && run.stopping !== "lost") queued.set(run.thread, { channel: run.channel, texts: run.pending })
    if (!closing) await drain()
    deps.freed?.()
  }

  async function drain(): Promise<void> {
    for (const [thread, item] of queued) {
      if (!hasRoom()) return
      queued.delete(thread)
      await converse({ thread, channel: item.channel, message: item.texts.length ? item.texts.join("\n\n") : null })
    }
    if (!hasRoom()) return
    for (const task of await board.tasks({ assignee: member, state: "ready" })) {
      if (!hasRoom()) return
      await work(task)
    }
  }

  async function work(task: Task): Promise<void> {
    const thread = String(task.id)
    if (closing || runs.has(thread) || !waitsFor(task, member)) return
    const folder = await folderOrNotice(thread, task.channel)
    if (!folder || !hasRoom()) return
    const claimed = await board.claim(task.id)
    if (!claimed) return
    epochs.set(claimed.id, claimed.claimEpoch)
    const history = await board.thread(thread)
    launch(
      {
        thread,
        channel: task.channel,
        purpose: "work",
        claim: { taskId: claimed.id, epoch: claimed.claimEpoch },
        prompt: () => workPrompt({ task: claimed, thread: history }),
      },
      folder,
    )
  }

  async function adopt(task: Task): Promise<void> {
    const thread = String(task.id)
    if (closing || runs.has(thread)) return
    const folder = await folderOrNotice(thread, task.channel)
    if (!folder || !hasRoom()) return
    epochs.set(task.id, task.claimEpoch)
    const history = await board.thread(thread)
    launch(
      {
        thread,
        channel: task.channel,
        purpose: "work",
        claim: { taskId: task.id, epoch: task.claimEpoch },
        prompt: (resuming) => (resuming ? resumeWorkPrompt(task) : workPrompt({ task, thread: history })),
      },
      folder,
    )
  }

  async function converse(options: { thread: string; channel: string; message: string | null }): Promise<void> {
    const { thread, channel, message } = options
    if (closing) return
    const live = runs.get(thread)
    if (live) {
      if (message !== null && (!harness.capabilities.streaming || !live.session.send(message))) live.pending.push(message)
      return
    }
    const folder = await folderOrNotice(thread, channel)
    if (!folder) return
    if (!hasRoom()) {
      const waiting = queued.get(thread)?.texts ?? []
      queued.set(thread, { channel, texts: message === null ? waiting : [...waiting, message] })
      return
    }
    const history = await board.thread(thread)
    const task = history.taskId === null ? null : await board.task(history.taskId)
    const claim = task && task.state === "claimed" && task.holder === member ? { taskId: task.id, epoch: task.claimEpoch } : null
    if (claim) epochs.set(claim.taskId, claim.epoch)
    launch(
      { thread, channel, purpose: "talk", claim, prompt: (resuming) => (resuming && message !== null ? message : conversationPrompt(history)) },
      folder,
    )
  }

  async function onReply(event: BoardEvent): Promise<void> {
    const threadId = event.threadId
    if (threadId === null || event.messageId === null) return
    const history: Thread = await board.thread(threadId)
    const entry = history.entries.find((e) => e.id === event.messageId)
    if (!entry || entry.kind !== "reply" || entry.deleted) return
    const message = followUpPrompt({ thread: threadId, who: event.actor, text: entry.text })
    if (runs.has(threadId)) {
      await converse({ thread: threadId, channel: history.channel, message })
      return
    }
    const task = history.taskId === null ? null : await board.task(history.taskId)
    const route = routeReply({ member, thread: history, task })
    switch (route) {
      case "work":
        if (task) await work(task)
        return
      case "converse":
        await converse({ thread: threadId, channel: history.channel, message })
        return
      case "ignore":
        return
      default: {
        const never: never = route
        throw new Error(`Unknown route ${String(never)}`)
      }
    }
  }

  async function onPost(event: BoardEvent): Promise<void> {
    const thread = event.messageId
    if (thread === null || event.channel === null) return
    await converse({ thread, channel: event.channel, message: null })
  }

  async function onTaskEvent(event: BoardEvent): Promise<void> {
    const taskId = event.taskId
    if (taskId === null) return
    const run = runs.get(String(taskId))
    if (run?.claim) {
      if (run.stopping || event.actor === member) return
      if (!(await stillHeld(run.claim))) stop(run, "lost")
      return
    }
    const state = eventData(event).state
    if (state === undefined || !claimable[state]) return
    await work(await board.task(taskId))
  }

  function onStopRequest(event: BoardEvent): void {
    const run = event.threadId === null ? undefined : runs.get(event.threadId)
    if (run && eventData(event).member === member) stop(run, "asked")
  }

  function logOwn(event: BoardEvent): void {
    if (event.type === eventTypes.asked || event.type === eventTypes.taskAsked) log(`${member}: ask in ${event.threadId}: waiting for a person`)
  }

  async function handle(event: BoardEvent): Promise<void> {
    if (event.actor === member) logOwn(event)
    else if (startsConversation(event, member)) await onPost(event)
    else if (event.type === eventTypes.replied) await onReply(event)
    else if (event.type === eventTypes.stopRequested) onStopRequest(event)
    else if (event.type === eventTypes.answered && runs.has(event.threadId ?? "")) log(`${member}: answer in ${event.threadId}: ${eventData(event).option ?? "?"} by ${event.actor}`)
    else if (isTaskEvent(event)) await onTaskEvent(event)
  }

  return {
    runs,
    start(): Promise<void> {
      return enqueue(async () => {
        if (!(await board.isMember())) throw new Error(`${member} is not a member of the board`)
        const held = (await board.tasks({ member, state: "claimed" })).filter((t) => t.holder === member)
        for (const task of held) await adopt(task)
        await drain()
      })
    },
    receive(event: BoardEvent): Promise<void> {
      return enqueue(() => handle(event))
    },
    nudge(): Promise<void> {
      return enqueue(async () => {
        if (!closing) await drain()
      })
    },
    working: () => runs.size > 0,
    active: () => runs.size,
    async shutdown(): Promise<void> {
      closing = true
      const current = [...runs.values()]
      await enqueue(async () => {
        for (const run of current) stop(run, "shutdown")
      })
      await Promise.all(current.map((run) => run.done))
      await chain
    },
    idle: () => chain,
  }
}

export type Runner = ReturnType<typeof createRunner>
