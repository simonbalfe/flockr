import type { CreateTaskBody, Task } from "@flockr/contracts"
import { asc, eq, inArray } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { messages, tasks, type MemberRow, type TaskRow } from "../db/schema"
import { invalid } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { findMember, findMessage, getTask, parseThreadId, requireChannel } from "./read"
import { emitTask, feedCard, lockTask, requireState, taskReply, threadEvent, updateTask } from "./write"

interface NewTask {
  channel: string
  title: string
  assignee: string | null
  needs: number[]
  labels: string[]
  kind: string
  spec: string | null
}

async function stateForNeeds(tx: Tx, needs: number[]): Promise<"ready" | "waiting"> {
  if (!needs.length) return "ready"
  const rows = await tx.select({ id: tasks.id, state: tasks.state }).from(tasks).where(inArray(tasks.id, needs))
  const missing = needs.filter((n) => !rows.some((r) => r.id === n))
  if (missing.length) throw invalid(`Needed tasks do not exist: ${missing.map((n) => `#${n}`).join(", ")}`)
  return rows.every((r) => r.state === "done") ? "ready" : "waiting"
}

export async function insertTask(tx: Tx, emit: Emit, actor: string, values: NewTask): Promise<TaskRow> {
  await requireChannel(tx, values.channel)
  if (values.assignee !== null && !(await findMember(tx, values.assignee))) throw invalid(`Member ${values.assignee} does not exist`)
  const state = await stateForNeeds(tx, values.needs)
  const [row] = await tx
    .insert(tasks)
    .values({ ...values, state })
    .returning()
  if (!row) throw new Error("Task insert returned nothing")
  await feedCard(tx, row, actor, "task")
  emitTask(emit, "task.created", row, actor, { title: row.title, assignee: row.assignee })
  return row
}

export async function createTask(db: Database, actor: string, body: CreateTaskBody): Promise<Task> {
  const id = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const row = await insertTask(tx, emit, actor, {
      channel: body.channel,
      title: body.title,
      assignee: body.assignee,
      needs: body.needs,
      labels: body.labels,
      kind: body.kind,
      spec: body.spec,
    })
    if (body.text?.trim()) await taskReply(tx, row, actor, body.text.trim())
    return row.id
  })
  return getTask(db, id)
}

export async function makeTaskFromThread(db: Database, actor: string, threadId: string): Promise<Task> {
  const id = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const ref = parseThreadId(threadId)
    if (ref.kind === "task") throw invalid(`#${ref.id} is already a task`)
    const root = await findMessage(tx, ref.id)
    if (root.kind !== "text") throw invalid(`Thread ${threadId} has no message to make a task from`)
    const stripped = (root.deletedAt ? "" : root.body).replace(/`/g, "").replace(/@\w+/g, "").trim().replace(/[.?]$/, "")
    const row = await insertTask(tx, emit, actor, {
      channel: root.channel,
      title: stripped.length > 60 ? `${stripped.slice(0, 57)}...` : stripped || "Untitled task",
      assignee: null,
      needs: [],
      labels: [],
      kind: "build",
      spec: null,
    })
    const entries = await tx.select().from(messages).where(eq(messages.parentId, root.id)).orderBy(asc(messages.id))
    const copies = new Map<number, number>()
    for (const e of entries) {
      const [copy] = await tx
        .insert(messages)
        .values({
          channel: row.channel,
          kind: e.kind,
          who: e.who,
          body: e.body,
          mentions: e.mentions,
          labels: e.labels,
          question: e.question,
          answer: e.answer,
          answeredBy: e.answeredBy,
          answeredAt: e.answeredAt,
          activity: e.activity,
          system: e.system,
          threadTaskId: row.id,
          replyToId: e.replyToId === null ? null : (copies.get(e.replyToId) ?? null),
          deletedAt: e.deletedAt,
          deletedBy: e.deletedBy,
          createdAt: e.createdAt,
        })
        .returning({ id: messages.id })
      if (copy) copies.set(e.id, copy.id)
    }
    return row.id
  })
  return getTask(db, id)
}

export async function giveTask(db: Database, actor: string, id: number, to: string): Promise<Task> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const target: MemberRow | undefined = await findMember(tx, to)
    if (!target) throw invalid(`Member ${to} does not exist`)
    const task = await lockTask(tx, id)
    requireState(task, "ready", "waiting")
    const row = await updateTask(tx, id, { assignee: to })
    await threadEvent(tx, row, actor, `gave this task to ${to}`)
    emitTask(emit, "task.assigned", row, actor, { assignee: to })
  })
  return getTask(db, id)
}
