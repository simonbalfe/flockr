import * as sdk from "@flockr/client"
import { activityEventTypes, applyActivityUpdates, connectLive, partHeadline, type ActivityEntry, type ActivityUpdate, type BoardEvent } from "@flockr/client"
import { ActivityPostedData, ActivityUpdatedData } from "@flockr/client/activity"
import { run } from "./api"
import { clock } from "./format"
import { envKey } from "./config"

type State = Parameters<typeof applyActivityUpdates>[0]

const replied = "reply.posted"
const endWord = { ok: "done", error: "failed", stopped: "stopped" } as const satisfies Record<Exclude<State["status"], "running">, string>

const indent = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")

const header = (entry: ActivityEntry, at: string) => `-- ${clock(at)}  ${entry.title} in ${entry.threadId} (#${entry.channel})`

function stepLines(state: State, updates: ActivityUpdate[], at: string): string[] {
  const time = clock(at)
  return updates.flatMap((update): string[] => {
    switch (update.type) {
      case "part.set": {
        const part = state.parts.find((p) => p.id === update.part.id)
        return part ? [`  ${time}  ${partHeadline(part)}`] : []
      }
      case "part.finished": {
        const part = state.parts.find((p) => p.id === update.partId)
        return part && update.status === "error" ? [`  ${time}  ${partHeadline(part)}`] : []
      }
      case "part.append":
        return []
      case "run.finished":
        return [`-- ${time}  ${endWord[update.status]}: ${update.title ?? state.title}`, ""]
      default: {
        const never: never = update
        return [String(never)]
      }
    }
  })
}

function caughtUp(entry: ActivityEntry, at: string): string[] {
  const parts = entry.parts.map((part) => `  ${clock(at)}  ${partHeadline(part)}`)
  return [header(entry, at), ...parts, ...(entry.status === "running" ? [] : [`-- ${endWord[entry.status]}: ${entry.title}`, ""])]
}

export function createWatch(options: { name: string; fetchEntry: (id: string) => Promise<ActivityEntry> }) {
  const { name, fetchEntry } = options
  const entries = new Map<string, State>()

  const keep = (id: string, state: State) => {
    if (state.status === "running") entries.set(id, state)
    else entries.delete(id)
  }

  async function refetch(id: string, at: string): Promise<string[]> {
    const entry = await fetchEntry(id)
    keep(id, { ...entry, key: null })
    return caughtUp(entry, at)
  }

  async function updated(event: BoardEvent, id: string): Promise<string[]> {
    const data = ActivityUpdatedData.safeParse(event.data)
    if (!data.success) return []
    const current = entries.get(id)
    if (!current) return refetch(id, event.at)
    if (data.data.revision <= current.revision) return []
    if (data.data.revision !== current.revision + 1) return refetch(id, event.at)
    const next = applyActivityUpdates(current, data.data.updates, data.data.at)
    if (!next.ok) return refetch(id, event.at)
    keep(id, next.state)
    return stepLines(next.state, data.data.updates, data.data.at)
  }

  return {
    seed(running: ActivityEntry[], at: string): string[] {
      return running.filter((e) => e.status === "running" && !entries.has(e.id)).flatMap((entry) => {
        keep(entry.id, { ...entry, key: null })
        return caughtUp(entry, at)
      })
    },
    async lines(event: BoardEvent): Promise<string[]> {
      if (event.actor !== name || event.messageId === null) return []
      if (event.type === activityEventTypes.posted) {
        const data = ActivityPostedData.safeParse(event.data)
        if (!data.success || entries.has(event.messageId)) return []
        keep(event.messageId, { ...data.data.entry, key: null })
        return [header(data.data.entry, event.at)]
      }
      if (event.type === activityEventTypes.updated) return updated(event, event.messageId)
      return []
    },
  }
}

async function replyText(event: BoardEvent): Promise<string[]> {
  if (event.threadId === null || event.messageId === null) return []
  const thread = await run(sdk.getThread({ path: { id: event.threadId } }))
  const entry = thread.entries.find((e) => e.id === event.messageId)
  return entry && entry.kind === "reply" ? [`  ${clock(event.at)}  replied in ${event.threadId}:`, indent(entry.text), ""] : []
}

export async function watchAgent(options: { baseUrl: string; name: string }): Promise<number> {
  const { baseUrl, name } = options
  await run(sdk.getAgent({ path: { name } }))
  const watch = createWatch({ name, fetchEntry: async (id) => run(sdk.getActivityEntry({ path: { id } })) })
  let chain: Promise<void> = Promise.resolve()
  const write = (lines: string[]) => void (lines.length ? console.log(lines.join("\n")) : undefined)
  const queue = (job: () => Promise<void>) => {
    chain = chain.then(job).catch((error: unknown) => console.error(error instanceof Error ? error.message : String(error)))
  }
  connectLive({
    baseUrl,
    key: envKey,
    onHello: () =>
      queue(async () => {
        console.log(`Watching ${name} on ${baseUrl}: each run's steps show here as it works.`)
        write(watch.seed(await run(sdk.listAgentActivity({ path: { name } })), new Date().toISOString()))
      }),
    onStatus: (up) => void (up ? undefined : console.error("disconnected, reconnecting")),
    onEvent: (event) =>
      queue(async () => {
        write(await watch.lines(event))
        if (event.actor === name && event.type === replied) write(await replyText(event))
      }),
  })
  await new Promise(() => undefined)
  return 0
}
