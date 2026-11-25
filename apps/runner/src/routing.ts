import { activityEventTypes, taskStates, type BoardEvent, type Task, type TaskState, type Thread } from "@flockr/client"
import { z } from "zod"

export const eventTypes = {
  posted: "message.posted",
  replied: "reply.posted",
  asked: "question.asked",
  answered: "question.answered",
  taskAsked: "task.asked",
  handedOff: "task.handed_off",
  stopRequested: activityEventTypes.stopRequested,
} as const

export const claimable = { waiting: false, ready: true, claimed: false, blocked: false, review: false, done: false } as const satisfies Record<TaskState, boolean>

const EventData = z.object({
  mentions: z.array(z.string()).catch([]),
  direct: z.boolean().catch(false),
  state: z.enum(taskStates).optional().catch(undefined),
  option: z.string().optional().catch(undefined),
  member: z.string().optional().catch(undefined),
  from: z.string().nullable().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
})

export const eventData = (event: BoardEvent) => EventData.parse(event.data)

export const isTaskEvent = (event: BoardEvent) => event.taskId !== null && event.type.startsWith("task.")

export function startsConversation(event: BoardEvent, member: string): boolean {
  return event.type === eventTypes.posted && event.actor !== member && event.messageId !== null && eventData(event).mentions.includes(member)
}

export function addressedDirectly(event: BoardEvent, member: string): boolean {
  const data = eventData(event)
  return event.type === eventTypes.replied && event.actor !== member && data.direct && data.mentions.includes(member)
}

export const waitsFor = (task: Task, member: string) => claimable[task.state] && task.assignee === member

export const holds = (task: Task, member: string, epoch: number) => task.state === "claimed" && task.holder === member && task.claimEpoch === epoch

export function joined(options: { member: string; thread: Thread; task: Task | null }): boolean {
  const { member, thread, task } = options
  if (task && (task.holder === member || task.assignee === member)) return true
  if (thread.root && (thread.root.who === member || thread.root.mentions.includes(member))) return true
  return thread.entries.some((entry) => entry.kind === "reply" && entry.who === member)
}

export type ReplyRoute = "work" | "converse" | "ignore"

export function routeReply(options: { member: string; thread: Thread; task: Task | null }): ReplyRoute {
  if (options.task && waitsFor(options.task, options.member)) return "work"
  return joined(options) ? "converse" : "ignore"
}

// Agents may answer each other, but not forever: after this many agent messages in a row in a
// thread, with no person in between, an agent's reply wakes nobody until a person speaks.
export const agentChainLimit = 4

export function agentChain(thread: Thread, people: ReadonlySet<string>): number {
  const said = [...(thread.root ? [thread.root] : []), ...thread.entries.filter((e) => e.kind === "reply" && !e.deleted)]
  let run = 0
  for (const entry of said.reverse()) {
    if (people.has(entry.who)) break
    run += 1
  }
  return run
}
