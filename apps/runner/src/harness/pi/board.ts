import * as sdk from "@flockr/client"
import type { ActivityUpdate, Client, MemberKind, Task, Thread } from "@flockr/client"
import { boardClient, call, type AskResult } from "../../board"

export interface NewTask {
  channel: string
  title: string
  spec: string | null
  assignee: string | null
  text: string
}

export interface PiBoard {
  thread: (id: string) => Promise<Thread>
  reply: (thread: string, text: string) => Promise<void>
  ask: (thread: string, question: { text: string; detail: string; options: string[] }) => Promise<AskResult>
  tasks: (channel: string) => Promise<Task[]>
  createTask: (task: NewTask) => Promise<Task>
  memberKind: (name: string) => Promise<MemberKind | null>
  updateEntry: (entryId: string, updates: ActivityUpdate[]) => Promise<void>
}

export function piBoard(options: { member: string; client: Client }): PiBoard {
  const on = { client: options.client }
  const port = boardClient(options)
  return {
    thread: port.thread,
    reply: port.reply,
    ask: port.ask,
    tasks: (channel) => call(sdk.listTasks({ ...on, query: { channel } })),
    createTask: (task) => call(sdk.createTask({ ...on, body: { ...task, needs: [], labels: [], kind: "build" } })),
    async memberKind(name) {
      const members = await call(sdk.listMembers(on))
      return members.find((m) => m.name === name)?.kind ?? null
    },
    updateEntry: port.updateEntry,
  }
}

export type FencedBoard = (channel: string | null) => PiBoard

export function fencedPiBoard(options: { member: string; clientFor: (channels: string[] | null) => Client }): FencedBoard {
  const boards = new Map<string, PiBoard>()
  return (channel) => {
    const key = channel ?? ""
    const known = boards.get(key)
    if (known) return known
    const made = piBoard({ member: options.member, client: options.clientFor(channel === null ? null : [channel]) })
    boards.set(key, made)
    return made
  }
}
