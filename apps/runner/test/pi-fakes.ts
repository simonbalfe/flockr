import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createModels, fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai"
import type { ActivityUpdate, MemberKind, Task, Thread, ThreadEntry } from "@flockr/client"
import type { BuiltInModel } from "../src/config"
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node"
import { createPiHarness } from "../src/harness/pi-durable"
import { fileStore } from "../src/harness/pi/file-store"
import { defaultAgentSettings } from "../src/harness/pi/agent"
import type { NewTask, PiBoard } from "../src/harness/pi/board"
import type { ModelSource } from "../src/harness/pi/model"
import { defaultRule } from "../src/permissions"
import type { SessionSpec } from "../src/harness/types"

export const member = "scout"
export const person = "dana"
const at = "2026-11-24T10:00:00.000Z"

export class FakePiBoard implements PiBoard {
  threads = new Map<string, Thread>()
  replies: { thread: string; text: string }[] = []
  asked: { thread: string; text: string; options: string[] }[] = []
  created: NewTask[] = []
  updates: { entryId: string; updates: ActivityUpdate[] }[] = []
  kinds: Record<string, MemberKind> = { [person]: "person", [member]: "agent", helper: "agent" }
  crashAfterReply = false
  fences: (string | null)[] = []
  private next = 100

  constructor(root: { thread: string; who: string; text: string }) {
    this.threads.set(root.thread, {
      id: root.thread,
      channel: "general",
      taskId: null,
      root: { kind: "text", id: root.thread, channel: "general", who: root.who, at, text: root.text, deleted: false, mentions: [member], labels: [], editedAt: null, taskId: null, threadId: null, thread: null, blocks: [], reactions: [], files: [] },
      entries: [],
    })
  }

  private push(thread: string, entry: ThreadEntry): void {
    const current = this.threads.get(thread)
    if (!current) throw new Error(`no thread ${thread}`)
    this.threads.set(thread, { ...current, entries: [...current.entries, entry] })
  }

  say(thread: string, who: string, text: string): string {
    const id = `m${(this.next += 1)}`
    this.push(thread, { kind: "reply", id, who, at, text, deleted: false, mentions: [], labels: [], editedAt: null, replyTo: null, blocks: [], reactions: [], files: [] })
    return id
  }

  startActivity(thread: string, runId: string): string {
    const id = `m${(this.next += 1)}`
    this.push(thread, { kind: "activity", id, threadId: thread, channel: "general", who: member, at, title: "Answering", runId, status: "running", revision: 1, updatedAt: at, endedAt: null, stopRequestedAt: null, parts: [] })
    return id
  }

  async thread(id: string): Promise<Thread> {
    const found = this.threads.get(id)
    if (!found) throw new Error(`no thread ${id}`)
    return found
  }

  async reply(thread: string, text: string): Promise<void> {
    this.say(thread, member, text)
    this.replies.push({ thread, text })
    if (this.crashAfterReply) throw new Error("the process died right after posting")
  }

  async ask(thread: string, question: { text: string; detail: string; options: string[] }) {
    const id = `m${(this.next += 1)}`
    const entry = { kind: "question", id, threadId: thread, channel: "general", who: member, at, question, answer: null, answeredBy: null, to: null } as const
    this.push(thread, entry)
    this.asked.push({ thread, text: question.text, options: question.options })
    return { kind: "asked", question: entry } as const
  }

  async tasks(): Promise<Task[]> {
    return []
  }

  async createTask(task: NewTask): Promise<Task> {
    this.created.push(task)
    return {
      id: 900 + this.created.length,
      branch: `flockr/${900 + this.created.length}`,
      title: task.title,
      channel: task.channel,
      kind: "build",
      state: "ready",
      needs: [],
      labels: [],
      assignee: task.assignee,
      holder: null,
      leaseExpiresAt: null,
      claimEpoch: 0,
      spec: task.spec,
      commits: [],
      reason: null,
      question: null,
      replyCount: 0,
      planId: null,
      reviewer: null,
      reviewCommit: null,
      createdAt: at,
    }
  }

  async memberKind(name: string): Promise<MemberKind | null> {
    return this.kinds[name] ?? null
  }

  async updateEntry(entryId: string, updates: ActivityUpdate[]): Promise<void> {
    this.updates.push({ entryId, updates })
  }
}

export function fauxSource(steps: FauxResponseStep[]) {
  const faux = fauxProvider()
  faux.setResponses(steps)
  const models = createModels()
  models.setProvider(faux.provider)
  const model = faux.getModel()
  const source: ModelSource = { models, ref: () => ({ provider: model.provider, modelId: model.id }) }
  return { faux, source }
}

export const testModel = (overrides: Partial<BuiltInModel> = {}): BuiltInModel => ({
  baseUrl: "http://127.0.0.1:9/v1",
  keyEnv: "FLOCKR_TEST_MODEL_KEY",
  defaultModel: "faux-1",
  contextWindow: 128_000,
  maxTokens: 8192,
  key: "test-key-not-real",
  problem: null,
  ...overrides,
})

export const tempDir = () => mkdtempSync(path.join(tmpdir(), "flockr-pi-"))

export function piHarness(options: { board: FakePiBoard; source: ModelSource; dir: string; model?: BuiltInModel }) {
  const lines: string[] = []
  const harness = createPiHarness({
    model: () => options.model ?? testModel(),
    source: () => options.source,
    store: fileStore((name) => path.join(options.dir, name, "agent.sqlite")),
    boardFor: () => (channel) => {
      options.board.fences.push(channel)
      return options.board
    },
    workspace: (cwd) => new NodeExecutionEnv({ cwd }),
    log: (line) => lines.push(line),
    settings: { ...defaultAgentSettings, retry: { enabled: false } },
  })
  return { harness, lines }
}

export function spec(overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    title: "flockr scout m1",
    prompt: "A conversation in #general, thread m1. So far:\n\ndana: @scout hi\n\nAnswer the latest message.",
    instructions: "unused by this harness",
    folder: "",
    env: { FC_URL: "http://127.0.0.1:5173", FC_AS: member, FC_STATE: "/tmp/claims.json" },
    resumeId: null,
    bridge: { command: "bun", args: [], env: {} },
    timeLimitMs: 60_000,
    rule: defaultRule,
    claim: null,
    saver: null,
    thread: "m1",
    personality: null,
    model: null,
    activity: () => undefined,
    ...overrides,
  }
}
