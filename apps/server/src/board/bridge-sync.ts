import { Question, type ChatBridgeName } from "@flockr/contracts"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { bridgeFor, type BridgeButton, type BridgeConnection, type BridgeInbound, type BridgeSettings, type ChatBridge } from "../chat-bridges"
import { boardId } from "../config"
import type { Database, Tx } from "../db/client"
import { bridgeChannels, bridgeMessages, bridgeThreads, events, hookDeliveries, members, tasks, type BridgeChannelRow, type EventRow, type JobRow } from "../db/schema"
import { linkableChannel, linkedPerson } from "./bridges"
import { BoardError } from "./errors"
import { mutate, type Emit } from "./events"
import { answerQuestion } from "./flow"
import { finishJob, lockClaimedJob } from "./jobs"
import { postIn, replyIn } from "./messages"
import { answerInThread, placeOf } from "./questions"
import { findAnyMember, findMessage, messageKey, parseThreadId } from "./read"
import { approveTask } from "./review"
import { canSee, viewerOf } from "./visibility"
import { emitMessage, insertMessage } from "./write"

const Press = z.discriminatedUnion("k", [
  z.object({ k: z.literal("task"), task: z.number().int(), option: z.string() }),
  z.object({ k: z.literal("thread"), thread: z.string(), option: z.string() }),
  z.object({ k: z.literal("approve"), task: z.number().int(), commit: z.string().nullable() }),
])
type Press = z.infer<typeof Press>

const pressValue = (press: Press) => JSON.stringify(press)

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status })

async function linkOf(tx: Tx, bridge: ChatBridge, where: { channel: string } | { external: string }): Promise<BridgeChannelRow | undefined> {
  const [row] = await tx
    .select()
    .from(bridgeChannels)
    .where(and(eq(bridgeChannels.bridge, bridge.name), "channel" in where ? eq(bridgeChannels.channel, where.channel) : eq(bridgeChannels.external, where.external)))
  return row
}

async function fresh(tx: Tx, bridge: ChatBridge, key: string): Promise<boolean> {
  const rows = await tx.insert(hookDeliveries).values({ host: bridge.name, delivery: key }).onConflictDoNothing().returning()
  return rows.length > 0
}

async function ensureBridgeMember(tx: Tx, emit: Emit, bridge: ChatBridge): Promise<void> {
  if (await findAnyMember(tx, bridge.memberName)) return
  await tx.insert(members).values({ name: bridge.memberName, kind: "bridge", owner: null, source: `${bridge.label} sync` })
  emit({ type: "member.joined", actor: bridge.memberName, data: { name: bridge.memberName, kind: "bridge", owner: null } })
}

type Inbound<K extends BridgeInbound["kind"]> = Extract<BridgeInbound, { kind: K }>

async function bridgePost(tx: Tx, emit: Emit, options: { bridge: ChatBridge; channel: string; thread: string | null; text: string }) {
  const { bridge, channel, thread, text } = options
  await ensureBridgeMember(tx, emit, bridge)
  const who = bridge.memberName
  if (thread === null) {
    const row = await insertMessage(tx, { channel, kind: "text", who, body: text, mentions: [], labels: [] })
    emitMessage(emit, "message.posted", row, who, messageKey(row.id), { mentions: [], labels: [] })
    return row
  }
  const ref = parseThreadId(thread)
  const link = ref.kind === "task" ? { threadTaskId: ref.id } : { parentId: ref.id }
  const row = await insertMessage(tx, { channel, kind: "text", who, body: text, mentions: [], labels: [], ...link })
  emitMessage(emit, "reply.posted", row, who, thread, { mentions: [], labels: [] })
  return row
}

async function takeMessage(db: Database, bridge: ChatBridge, event: Inbound<"message">) {
  return mutate(db, async (tx, emit) => {
    if (!(await fresh(tx, bridge, event.key))) return { outcome: "duplicate" }
    const link = await linkOf(tx, bridge, { external: event.channel })
    if (!link) return { outcome: "ignored", reason: `${bridge.label} channel ${event.channel} is not linked` }
    const refusal = await linkableChannel(tx, link.channel)
    if (refusal) return { outcome: "ignored", reason: refusal }
    let thread: string | null = null
    if (event.thread !== null) {
      const [linked] = await tx
        .select()
        .from(bridgeThreads)
        .where(and(eq(bridgeThreads.bridge, bridge.name), eq(bridgeThreads.externalChannel, event.channel), eq(bridgeThreads.externalThread, event.thread)))
      if (!linked) return { outcome: "ignored", reason: "A reply under a thread that is not synced" }
      thread = linked.thread
    }
    const person = await linkedPerson(tx, bridge, event.user)
    const said = { text: event.text, labels: [] }
    const row = person
      ? thread === null
        ? await postIn(tx, emit, { actor: person.name, channel: link.channel, said })
        : await replyIn(tx, emit, { actor: person.name, threadId: thread, draft: said })
      : await bridgePost(tx, emit, { bridge, channel: link.channel, thread, text: `**${bridge.unlinkedAuthor(event.user)}**: ${event.text}` })
    await tx.insert(bridgeMessages).values({ bridge: bridge.name, message: row.id, externalChannel: event.channel, externalTs: event.ts }).onConflictDoNothing()
    if (thread === null) await tx.insert(bridgeThreads).values({ bridge: bridge.name, thread: messageKey(row.id), externalChannel: event.channel, externalThread: event.ts }).onConflictDoNothing()
    return { outcome: "posted", message: messageKey(row.id), as: row.who }
  })
}

async function cardChannel(db: Database, press: Press): Promise<string> {
  if (press.k === "thread") return mutate(db, async (tx) => (await placeOf(tx, press.thread)).channel)
  const [task] = await db.select({ channel: tasks.channel }).from(tasks).where(eq(tasks.id, press.task))
  if (!task) throw new BoardError("not_found", `Task #${press.task} does not exist`)
  return task.channel
}

async function runPress(db: Database, actor: string, press: Press): Promise<string> {
  switch (press.k) {
    case "task":
      await answerQuestion(db, actor, press.task, press.option)
      return `answered #${press.task}: ${press.option}`
    case "thread":
      await answerInThread(db, actor, press.thread, press.option)
      return `answered ${press.thread}: ${press.option}`
    case "approve":
      await approveTask(db, actor, press.task, press.commit ? { commit: press.commit } : {})
      return `approved #${press.task}`
    default: {
      const unhandled: never = press
      return unhandled
    }
  }
}

async function takePress(db: Database, bridge: ChatBridge, action: Inbound<"action">): Promise<Record<string, unknown>> {
  if (!(await mutate(db, (tx) => fresh(tx, bridge, action.key)))) return { outcome: "duplicate" }
  const decoded = Press.safeParse((() => {
    try {
      return JSON.parse(action.value)
    } catch {
      return null
    }
  })())
  if (!decoded.success) return { outcome: "ignored", reason: "Not a Flockr button" }
  const press = decoded.data
  const refuse = (reason: string) => ({ outcome: "refused", reason })
  try {
    const channel = await cardChannel(db, press)
    const link = await mutate(db, (tx) => linkOf(tx, bridge, { channel }))
    if (!link || link.external !== action.channel) return refuse(`This card's channel is not linked to this ${bridge.label} channel`)
    const person = await mutate(db, (tx) => linkedPerson(tx, bridge, action.user))
    if (!person) return refuse(`Your ${bridge.label} user is not linked to a person on the board; link it in Flockr Settings, ${bridge.label}`)
    if (!(await canSee(db, viewerOf(person.name), channel))) return refuse(`${person.name} cannot see #${channel}`)
    return { outcome: "done", as: person.name, did: await runPress(db, person.name, press) }
  } catch (error: unknown) {
    if (error instanceof BoardError) return refuse(error.message)
    throw error
  }
}

export async function receiveBridgeHook(db: Database, request: Request, bridge: ChatBridge, settings: BridgeSettings): Promise<Response> {
  const connection = settings[bridge.name]
  if (!connection) return answer(404, { error: `${bridge.label} sync is off on this board (its secrets are not set)`, kind: "not_found" })
  const body = await request.text()
  if (!(await bridge.verify(request.headers, body, connection))) return answer(401, { error: `The request's ${bridge.label} signature does not match`, kind: "unauthenticated" })
  let inbound: BridgeInbound
  try {
    inbound = bridge.parse(request.headers, body)
  } catch {
    return answer(400, { error: `The body is not what ${bridge.label} sends`, kind: "invalid" })
  }
  switch (inbound.kind) {
    case "challenge":
      return answer(200, { challenge: inbound.challenge })
    case "ignored":
      return answer(200, { outcome: "ignored", reason: inbound.reason })
    case "message":
      return answer(200, await takeMessage(db, bridge, inbound))
    case "action": {
      const result = await takePress(db, bridge, inbound)
      if (result.outcome === "refused" && inbound.respondTo && typeof result.reason === "string") await tellQuietly(bridge, connection, { to: inbound.respondTo, text: result.reason })
      return answer(200, result)
    }
    default: {
      const unhandled: never = inbound
      return unhandled
    }
  }
}

async function tellQuietly(bridge: ChatBridge, connection: BridgeConnection, message: { to: string; text: string }): Promise<void> {
  try {
    await bridge.tell(connection, message.to, message.text)
  } catch (error: unknown) {
    console.error(`${bridge.name}: could not tell the presser`, error)
  }
}

const BridgeJob = z.object({ bridge: z.string(), seq: z.number().int() })
const Asked = z.object({ question: Question })
const Answered = z.object({ option: z.string() })
const Submitted = z.object({ commit: z.string().nullable().optional() })

type Outgoing =
  | { kind: "skip"; reason: string }
  | { kind: "post"; thread: string | null; text: string; buttons: BridgeButton[]; rootOf: string | null; message: number | null }

const short = (sha: string | null | undefined) => (sha ? ` at \`${sha.slice(0, 7)}\`` : "")

async function threadIsNew(tx: Tx, key: string, linkedAt: Date): Promise<boolean | null> {
  const ref = parseThreadId(key)
  if (ref.kind === "task") {
    const [task] = await tx.select({ createdAt: tasks.createdAt }).from(tasks).where(eq(tasks.id, ref.id))
    return task ? task.createdAt >= linkedAt : null
  }
  const root = await findMessage(tx, ref.id)
  if (root.parentId !== null || root.threadTaskId !== null) return null
  return root.createdAt >= linkedAt
}

async function alreadyBridged(tx: Tx, bridge: ChatBridgeName, message: number): Promise<boolean> {
  const [row] = await tx.select().from(bridgeMessages).where(and(eq(bridgeMessages.bridge, bridge), eq(bridgeMessages.message, message)))
  return row !== undefined
}

async function outgoingFor(tx: Tx, bridge: ChatBridge, event: EventRow): Promise<Outgoing> {
  const taskId = event.taskId
  const messageId = event.messageId ? Number(event.messageId.slice(1)) : null
  const asText = async (id: number) => {
    if (await alreadyBridged(tx, bridge.name, id)) return null
    const row = await findMessage(tx, id)
    return row.deletedAt ? null : `**${row.who}**: ${row.body}`
  }
  const inThread = (text: string, buttons: BridgeButton[] = []): Extract<Outgoing, { kind: "post" }> => ({ kind: "post", thread: event.threadId, text, buttons, rootOf: null, message: null })
  switch (event.type) {
    case "message.posted": {
      if (messageId === null) return { kind: "skip", reason: "No message" }
      const text = await asText(messageId)
      if (text === null) return { kind: "skip", reason: `Came from ${bridge.label} or was deleted` }
      return { kind: "post", thread: null, text, buttons: [], rootOf: messageKey(messageId), message: messageId }
    }
    case "task.created": {
      if (taskId === null) return { kind: "skip", reason: "No task" }
      const [task] = await tx.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, taskId))
      return { kind: "post", thread: null, text: `**${event.actor}** created **#${taskId} ${task?.title ?? ""}**`, buttons: [], rootOf: String(taskId), message: null }
    }
    case "reply.posted": {
      if (messageId === null) return { kind: "skip", reason: "No message" }
      const text = await asText(messageId)
      if (text === null) return { kind: "skip", reason: `Came from ${bridge.label} or was deleted` }
      return { ...inThread(text), message: messageId }
    }
    case "task.asked":
    case "question.asked": {
      const { question } = Asked.parse(event.data)
      const press = (option: string): Press => (event.type === "task.asked" && taskId !== null ? { k: "task", task: taskId, option } : { k: "thread", thread: event.threadId ?? "", option })
      return inThread(`**${event.actor}** asks: ${question.text}${question.detail ? `\n\n${question.detail}` : ""}`, question.options.map((option) => ({ label: option, value: pressValue(press(option)) })))
    }
    case "task.submitted": {
      if (taskId === null) return { kind: "skip", reason: "No task" }
      const { commit } = Submitted.parse(event.data)
      return inThread(`**${event.actor}** submitted #${taskId} for review${short(commit)}. Ask for changes in Flockr.`, [{ label: "Approve", value: pressValue({ k: "approve", task: taskId, commit: commit ?? null }) }])
    }
    case "task.answered":
    case "question.answered":
      return inThread(`**${event.actor}** answered: ${Answered.parse(event.data).option}`)
    case "task.approved":
      return inThread(`**${event.actor}** approved #${taskId ?? ""}`)
    case "task.changes_requested":
      return inThread(`**${event.actor}** asked for changes on #${taskId ?? ""}`)
    default:
      return { kind: "skip", reason: `${event.type} is not synced` }
  }
}

export async function runBridgeJob(db: Database, job: JobRow, run: { now: Date; settings: BridgeSettings }): Promise<void> {
  const payload = BridgeJob.parse(job.payload)
  const bridge = bridgeFor(payload.bridge)
  const skip = (result: string) => mutate(db, async (tx, emit) => (await lockClaimedJob(tx, job)) && finishJob(tx, emit, job, { state: "skipped", result }, run.now))
  if (!bridge) return void (await skip(`No bridge ${payload.bridge}`))
  const connection = run.settings[bridge.name]
  if (!connection) return void (await skip(`${bridge.label} sync is off (its secrets are not set)`))
  const plan = await mutate(db, async (tx) => {
    const [event] = await tx.select().from(events).where(and(eq(events.boardId, boardId), eq(events.seq, payload.seq)))
    if (!event?.channel) return { kind: "skip", reason: `No event ${payload.seq}` } as const
    const link = await linkOf(tx, bridge, { channel: event.channel })
    if (!link) return { kind: "skip", reason: `#${event.channel} is no longer linked` } as const
    if (await linkableChannel(tx, event.channel)) return { kind: "skip", reason: `#${event.channel} can no longer sync` } as const
    const outgoing = await outgoingFor(tx, bridge, event)
    if (outgoing.kind === "skip") return outgoing
    if (outgoing.thread === null) return { kind: "send", link, outgoing, externalThread: null } as const
    const [thread] = await tx.select().from(bridgeThreads).where(and(eq(bridgeThreads.bridge, bridge.name), eq(bridgeThreads.thread, outgoing.thread)))
    if (thread) return { kind: "send", link, outgoing, externalThread: thread.externalThread } as const
    const fresh = await threadIsNew(tx, outgoing.thread, link.linkedAt)
    if (fresh) throw new Error(`Thread ${outgoing.thread} is not on ${bridge.label} yet; waiting for its first post`)
    return { kind: "skip", reason: `Thread ${outgoing.thread} started before #${event.channel} was linked` } as const
  })
  if (plan.kind === "skip") return void (await skip(plan.reason))
  const { link, outgoing, externalThread } = plan
  const sent = await bridge.post(connection, { channel: link.external, thread: externalThread, text: outgoing.text, buttons: outgoing.buttons })
  await mutate(db, async (tx, emit) => {
    if (!(await lockClaimedJob(tx, job))) return
    if (outgoing.rootOf) await tx.insert(bridgeThreads).values({ bridge: bridge.name, thread: outgoing.rootOf, externalChannel: link.external, externalThread: sent.ts }).onConflictDoNothing()
    if (outgoing.message !== null) await tx.insert(bridgeMessages).values({ bridge: bridge.name, message: outgoing.message, externalChannel: link.external, externalTs: sent.ts }).onConflictDoNothing()
    await finishJob(tx, emit, job, { state: "done", result: `Posted ${sent.ts}` }, run.now)
  })
}

