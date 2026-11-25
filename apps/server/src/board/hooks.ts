import type { CodeHostEventKind } from "@flockr/contracts"
import { and, desc, eq, sql } from "drizzle-orm"
import type { CodeHost, CodeHostEvent } from "../code-hosts"
import type { Database, Tx } from "../db/client"
import { channels, events, hookDeliveries, members, tasks, type TaskRow } from "../db/schema"
import { recordCommit } from "./commits"
import { mutate, type Emit } from "./events"
import { findAnyMember } from "./read"
import { emitMessage, emitTask, insertMessage } from "./write"


export type HookOutcome = { outcome: "posted"; task: number } | { outcome: "duplicate" } | { outcome: "ignored"; reason: string }

const bodyChars = 2000
const branchTask = /^flockr\/(\d+)(?:$|[-/])/

const verbs: Record<CodeHostEventKind, string> = {
  opened: "opened",
  reopened: "reopened",
  closed: "closed without merging",
  merged: "merged",
  commented: "commented on",
  approved: "approved",
  changes_requested: "asked for changes on",
  reviewed: "reviewed",
}

export function hookText(event: CodeHostEvent): string {
  const link = `[#${event.number} ${event.title}](${event.url})`
  const from = event.kind === "opened" && event.branch ? ` from \`${event.branch}\`` : ""
  const head = event.kind === "closed" ? `**${event.author}** closed ${link} without merging` : `**${event.author}** ${verbs[event.kind]} ${link}${from}`
  if (!event.body?.trim()) return head
  const text = event.body.length > bodyChars ? `${event.body.slice(0, bodyChars)}…` : event.body
  return `${head}\n\n${text.split("\n").map((line) => `> ${line}`).join("\n")}`
}

async function taskFor(tx: Tx, host: CodeHost, event: CodeHostEvent): Promise<number | null> {
  const fromBranch = event.branch ? branchTask.exec(event.branch)?.[1] : undefined
  if (fromBranch) return Number(fromBranch)
  const [earlier] = await tx
    .select({ taskId: events.taskId })
    .from(events)
    .where(and(eq(events.type, "task.code_host"), sql`${events.data}->>'host' = ${host.name}`, sql`${events.data}->>'repo' = ${event.repo}`, sql`(${events.data}->>'number')::int = ${event.number}`))
    .orderBy(desc(events.seq))
    .limit(1)
  return earlier?.taskId ?? null
}

async function ensureBridge(tx: Tx, emit: Emit, host: CodeHost): Promise<void> {
  if (await findAnyMember(tx, host.memberName)) return
  await tx.insert(members).values({ name: host.memberName, kind: "bridge", owner: null, source: `${host.name} webhooks` })
  emit({ type: "member.joined", actor: host.memberName, data: { name: host.memberName, kind: "bridge", owner: null } })
}

export async function receiveCodeHostEvent(db: Database, host: CodeHost, delivery: string, event: CodeHostEvent): Promise<HookOutcome> {
  return mutate(db, async (tx, emit): Promise<HookOutcome> => {
    const [fresh] = await tx.insert(hookDeliveries).values({ host: host.name, delivery }).onConflictDoNothing().returning()
    if (!fresh) return { outcome: "duplicate" }
    const id = await taskFor(tx, host, event)
    if (id === null) return { outcome: "ignored", reason: `${event.repo}#${event.number} is not linked to a task (branch flockr/<task>)` }
    const [found] = await tx.select({ task: tasks, repo: channels.repo }).from(tasks).innerJoin(channels, eq(channels.id, tasks.channel)).where(eq(tasks.id, id)).for("update", { of: tasks })
    if (!found) return { outcome: "ignored", reason: `No task ${id}` }
    if (found.repo !== event.repo) return { outcome: "ignored", reason: `Task ${id}'s channel has repo ${found.repo ?? "none"}, not ${event.repo}` }
    const task: TaskRow = found.task
    await ensureBridge(tx, emit, host)
    const row = await insertMessage(tx, { channel: task.channel, kind: "text", who: host.memberName, body: hookText(event), mentions: [], labels: [], threadTaskId: task.id })
    emitMessage(emit, "reply.posted", row, host.memberName, String(task.id), { mentions: [], labels: [] })
    emitTask(emit, "task.code_host", task, host.memberName, { host: host.name, repo: event.repo, number: event.number, kind: event.kind, url: event.url, author: event.author })
    if (event.kind === "merged" && event.mergeSha) await recordCommit(tx, emit, task, host.memberName, { sha: event.mergeSha, message: `Merge #${event.number}: ${event.title}` })
    return { outcome: "posted", task: task.id }
  })
}
