import * as sdk from "@flockr/client"
import type { Draft, MyThread, SavedItem, SentItem } from "@flockr/client"
import type { CommandContext } from "./activity"
import { run } from "./api"
import { need } from "./args"
import { channelLine } from "./format"

const short = (text: string) => text.replace(/\s+/g, " ").slice(0, 100)
const isThreadId = (id: string) => /^(m\d+|\d+)$/.test(id)
const clean = (id: string) => id.replace(/^#/, "")

const threadLine = (t: MyThread) => `${t.threadId.padEnd(6)} ${t.status.replace("_", " ").padEnd(9)} #${t.channel.padEnd(12)} ${t.unread ? `${t.unread} new  ` : ""}${t.replies} replies, last ${t.lastWho}: ${short(t.lastText)}  (${short(t.title)})`
const savedLine = (s: SavedItem) => `${s.id.padEnd(6)} #${s.channel.padEnd(12)} ${s.who}: ${s.deleted ? "(message deleted)" : short(s.text)}`
const draftLine = (d: Draft) => `${d.kind === "thread" ? d.target.padEnd(6) : `#${d.target}`.padEnd(14)} ${short(d.text)}`
const sentLine = (s: SentItem) => `${s.id.padEnd(6)} ${s.kind.padEnd(8)} #${s.channel.padEnd(12)} ${short(s.text)}`

export async function dmCommand({ positionals, print }: CommandContext): Promise<number> {
  const channel = await run(sdk.openDirectMessage({ body: { with: need(positionals[1], "member").replace(/^@/, "") } }))
  const text = positionals.slice(2).join(" ").trim()
  if (text === "") {
    print(channel, () => channelLine(channel))
    return 0
  }
  const result = await run(sdk.postMessage({ path: { channel: channel.id }, body: { text, labels: [] } }))
  print(result, () => `Sent ${result.message.id} in ${channel.id}`)
  return 0
}

export async function threadsCommand({ print }: CommandContext): Promise<number> {
  const list = await run(sdk.listMyThreads())
  print(list, () => (list.length ? list.map(threadLine).join("\n") : "You are not in any thread yet."))
  return 0
}

export async function sentCommand({ print }: CommandContext): Promise<number> {
  const list = await run(sdk.listSent())
  print(list, () => (list.length ? list.map(sentLine).join("\n") : "You have sent nothing yet."))
  return 0
}

export async function savedCommand({ positionals, print }: CommandContext): Promise<number> {
  const command = positionals[0]
  if (command === "save" || command === "unsave") {
    const id = clean(need(positionals[1], "message id"))
    const state = await run(command === "save" ? sdk.saveMessage({ path: { id } }) : sdk.unsaveMessage({ path: { id } }))
    print(state, () => `${state.id} ${state.saved ? "saved" : "removed from saved"}`)
    return 0
  }
  const list = await run(sdk.listSaved())
  print(list, () => (list.length ? list.map(savedLine).join("\n") : "Nothing saved. flockr save <message-id> saves one."))
  return 0
}

export async function draftsCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const target = positionals[1] === undefined ? undefined : clean(positionals[1])
  if (positionals[0] === "drafts" || target === undefined) {
    const list = await run(sdk.listDrafts())
    print(list, () => (list.length ? list.map(draftLine).join("\n") : "No drafts."))
    return 0
  }
  const text = values.clear ? "" : need(positionals.slice(2).join(" ").trim() || undefined, "text (or --clear)")
  const result = await run(sdk.saveDraft({ body: { kind: isThreadId(target) ? "thread" : "channel", target, text } }))
  print(result, () => (result.draft ? `Draft kept in ${target}` : `Draft cleared in ${target}`))
  return 0
}
