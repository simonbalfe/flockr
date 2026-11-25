import type { BoardEvent, Task, Thread, ThreadEntry } from "@flockr/client"
import type { EpochStore } from "@flockr/cli/epochs"
import type { BoardPort, Claim } from "../src/board"
import type { Harness, Session, SessionExit, SessionSpec } from "../src/harness/types"
import { createRunner, type AgentSettings, type Timers } from "../src/runner"
import type { JsonStore, SessionMap } from "../src/store"

export const member = "claude"

export function memoryStore<T>(initial: T): JsonStore<T> & { value: () => T } {
  let value = initial
  return { get: () => value, set: (next) => void (value = next), value: () => value }
}

export interface FakeSession {
  spec: SessionSpec
  sent: string[]
  stopped: boolean
  end: (exit: SessionExit) => void
}

export function fakeHarness(capabilities = { resume: true, streaming: true }, name = "fake") {
  const started: FakeSession[] = []
  let next = 0
  const harness: Harness = {
    name,
    label: "Fake Agent",
    capabilities,
    probe: () => ({ kind: "available" }),
    passEnv: [],
    permissions: { read: () => null, allow: () => ({ ok: true }), deny: (message) => ({ ok: false, message }) },
    start(spec) {
      next += 1
      let end: (exit: SessionExit) => void = () => undefined
      const exit = new Promise<SessionExit>((resolve) => (end = resolve))
      let running = true
      const record: FakeSession = {
        spec,
        sent: [],
        stopped: false,
        end: (value) => {
          running = false
          end(value)
        },
      }
      started.push(record)
      const session: Session = {
        id: spec.resumeId ?? `session-${next}`,
        exit,
        send(text) {
          if (!running) return false
          record.sent.push(text)
          return true
        },
        stop() {
          record.stopped = true
          record.end({ kind: "stopped" })
        },
        status: () => (running ? "running" : "exited"),
      }
      return session
    },
  }
  return { harness, started }
}

export function task(values: Partial<Task> & { id: number }): Task {
  return {
    title: "Add a health check",
    channel: "general",
    kind: "build",
    state: "ready",
    needs: [],
    labels: [],
    assignee: member,
    holder: null,
    leaseExpiresAt: null,
    claimEpoch: 0,
    spec: null,
    commits: [],
    reason: null,
    question: null,
    replyCount: 0,
    createdAt: "2026-11-24T10:00:00.000Z",
    ...values,
  }
}

export const reply = (id: string, who: string, text: string): ThreadEntry => ({ kind: "reply", id, who, at: "2026-11-24T10:00:00.000Z", text, deleted: false, mentions: [], labels: [], editedAt: null, replyTo: null })

export function messageThread(id: string, who: string, text: string, entries: ThreadEntry[] = []): Thread {
  return {
    id,
    channel: "general",
    taskId: null,
    root: { kind: "text", id, channel: "general", who, at: "2026-11-24T10:00:00.000Z", text, deleted: false, mentions: text.includes(`@${member}`) ? [member] : [], labels: [], editedAt: null, taskId: null, threadId: id, thread: null },
    entries,
  }
}

export function fakeBoard() {
  const tasks = new Map<number, Task>()
  const threads = new Map<string, Thread>()
  const calls: string[] = []
  let renewWorks = true
  let replyCount = 0
  const record = (line: string) => void calls.push(line)
  const held = (claim: Claim) => {
    const t = tasks.get(claim.taskId)
    return t !== undefined && t.state === "claimed" && t.holder === member && t.claimEpoch === claim.epoch
  }
  const port: BoardPort = {
    isMember: async () => true,
    async task(id) {
      const found = tasks.get(id)
      if (!found) throw new Error(`no task ${id}`)
      return found
    },
    tasks: async (query) =>
      [...tasks.values()].filter((t) => (query.state === undefined || t.state === query.state) && (query.assignee === undefined || t.assignee === query.assignee) && (query.member === undefined || t.holder === query.member || t.assignee === query.member)),
    async thread(id) {
      const found = threads.get(id) ?? (tasks.has(Number(id)) ? { id, channel: tasks.get(Number(id))?.channel ?? "general", taskId: Number(id), root: null, entries: [] } : undefined)
      if (!found) throw new Error(`no thread ${id}`)
      return found
    },
    async claim(id) {
      const t = tasks.get(id)
      if (!t || t.state !== "ready") return null
      const claimed = { ...t, state: "claimed" as const, holder: member, claimEpoch: t.claimEpoch + 1 }
      tasks.set(id, claimed)
      record(`claim ${id} epoch ${claimed.claimEpoch}`)
      return claimed
    },
    async renew(claim) {
      record(`renew ${claim.taskId} epoch ${claim.epoch}`)
      return renewWorks && held(claim)
    },
    async release(claim, keep) {
      record(`release ${claim.taskId} epoch ${claim.epoch}${keep ? " keep" : ""}`)
      if (!held(claim)) return false
      const t = tasks.get(claim.taskId)
      if (t) tasks.set(t.id, { ...t, state: "ready", holder: null, assignee: keep ? t.assignee : null })
      return true
    },
    async submit(claim, note) {
      record(`submit ${claim.taskId} epoch ${claim.epoch}: ${note}`)
      if (!held(claim)) return false
      const t = tasks.get(claim.taskId)
      if (t) tasks.set(t.id, { ...t, state: "review" })
      return true
    },
    async block(claim, reason) {
      record(`block ${claim.taskId} epoch ${claim.epoch}: ${reason}`)
      return held(claim)
    },
    async reply(thread, text) {
      replyCount += 1
      record(`reply ${thread}: ${text}`)
      const current = threads.get(thread)
      if (current) threads.set(thread, { ...current, entries: [...current.entries, reply(`r${replyCount}`, member, text)] })
    },
    async startEntry(thread, entry) {
      record(`entry ${thread}: ${entry.title}`)
      return `e-${thread}`
    },
    async updateEntry(entryId, updates) {
      record(`update ${entryId}: ${updates.map((u) => u.type).join(", ")}`)
    },
    async finishEntry(entryId, status) {
      record(`finish ${entryId} ${status}`)
    },
    ask: async () => ({ kind: "refused", reason: "not in this fake" }),
  }
  return {
    port,
    tasks,
    threads,
    calls,
    failRenew: () => void (renewWorks = false),
  }
}

export function manualTimers() {
  const pending: { ms: number; run: () => void; repeat: boolean; live: boolean }[] = []
  const timers: Timers = {
    after(ms, run) {
      const entry = { ms, run, repeat: false, live: true }
      pending.push(entry)
      return () => void (entry.live = false)
    },
    every(ms, run) {
      const entry = { ms, run, repeat: true, live: true }
      pending.push(entry)
      return () => void (entry.live = false)
    },
  }
  const fire = (ms: number) => {
    for (const entry of pending) if (entry.live && entry.ms === ms) entry.run()
  }
  return { timers, fire }
}

export function memoryEpochs(): EpochStore & { all: Map<number, number> } {
  const all = new Map<number, number>()
  return { all, get: (id) => all.get(id), set: (id, epoch) => void all.set(id, epoch), clear: (id) => void all.delete(id) }
}

export interface TestOptions {
  member: string
  settings: AgentSettings
  channels: Record<string, string>
  maxSessions: number
  maxMinutes: number
  folderExists: (folder: string) => boolean
}

export const testOptions = (values: Partial<TestOptions> = {}): TestOptions => ({
  member,
  settings: { folder: "/tmp/flockr-agent", permissions: "edit-free-commands-ask", personality: null, model: null },
  channels: { general: "/tmp/flockr-general" },
  maxSessions: 2,
  maxMinutes: 30,
  folderExists: () => true,
  ...values,
})

let seq = 100

export function event(values: Partial<BoardEvent> & { type: string; actor: string }): BoardEvent {
  seq += 1
  return { seq, at: "2026-11-24T10:00:00.000Z", channel: "general", taskId: null, threadId: null, messageId: null, data: {}, ...values }
}

export function setup(options: { config?: Partial<TestOptions>; capabilities?: { resume: boolean; streaming: boolean } } = {}) {
  const board = fakeBoard()
  const { harness, started } = fakeHarness(options.capabilities)
  const { timers, fire } = manualTimers()
  const sessions = memoryStore<SessionMap>({})
  const epochs = memoryEpochs()
  const logs: string[] = []
  const problems: string[] = []
  const config = testOptions(options.config)
  const runner = createRunner({
    ...config,
    settings: () => config.settings,
    harness,
    board: board.port,
    epochs,
    sessions,
    instructions: (settings) => `be brief${settings.personality ? `; ${settings.personality}` : ""}`,
    sessionEnv: { FC_URL: "http://localhost:5173", FC_AS: member, PATH: "/bin" },
    bridge: (thread, settings) => ({ command: "bun", args: ["bridge.ts"], env: { FLOCKR_THREAD: thread, FLOCKR_PERMISSIONS: settings.permissions } }),
    log: (line) => void logs.push(line),
    problem: (reason) => void problems.push(reason),
    timers,
  })
  return { runner, board, started, fire, sessions, epochs, logs, problems }
}
