import { currentStep, partHeadline, splitSubThreads, type ActivityEntry } from "@flockr/client"
import type {
  Activity,
  BoardEvent,
  Channel,
  FeedItem,
  Inbox,
  Member,
  MessageState,
  MessageVersions,
  SearchHit,
  SnippetPart,
  Task,
  TaskCommit,
  Thread,
  WorkingArea,
  AreaOverlap,
  ThreadEntry,
  ThreadQuestion,
} from "@flockr/client"

export const clock = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const lastCommit = (task: Task) => task.commits[task.commits.length - 1]?.short

export const commitLine = (c: TaskCommit) => [c.short, c.url, c.message].filter(Boolean).join("  ")

const minutesLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000)) : 0)

export function taskStatus(task: Task): string {
  switch (task.state) {
    case "waiting":
      return `waits on ${task.needs.map((n) => `#${n}`).join(", ")}`
    case "ready":
      return task.assignee ? `ready for ${task.assignee}` : "ready"
    case "claimed":
      return task.question ? `${task.holder} is asking a question` : `${task.holder}, ${minutesLeft(task.leaseExpiresAt)} min left, epoch ${task.claimEpoch}`
    case "blocked":
      return `blocked: ${task.reason ?? "no reason"}`
    case "review":
      return `in review${lastCommit(task) ? ` (${lastCommit(task)})` : ""}`
    case "done":
      return `done${lastCommit(task) ? ` in ${lastCommit(task)}` : ""}`
  }
}

export const taskLine = (task: Task) => `#${task.id}  ${task.state.padEnd(7)}  ${task.title}  [#${task.channel}, ${taskStatus(task)}]`

export function taskDetail(task: Task): string {
  const lines = [`#${task.id} ${task.title}`, `  channel   #${task.channel}`, `  state     ${task.state} (${taskStatus(task)})`, `  kind      ${task.kind}`]
  if (task.labels.length) lines.push(`  labels    ${task.labels.join(", ")}`)
  if (task.assignee) lines.push(`  for       ${task.assignee}`)
  if (task.holder) lines.push(`  holder    ${task.holder}`)
  if (task.reviewer) lines.push(`  reviewer  ${task.reviewer}`)
  if (task.reviewCommit) lines.push(`  in review at ${task.reviewCommit.slice(0, 7)} (approve with --commit ${task.reviewCommit.slice(0, 7)})`)
  if (task.needs.length) lines.push(`  needs     ${task.needs.map((n) => `#${n}`).join(", ")}`)
  if (task.planId !== null) lines.push(`  plan      ${task.planId} (flockr plans show ${task.planId})`)
  lines.push(`  branch    ${task.branch}`)
  if (task.spec) lines.push(`  spec      ${task.spec}`)
  for (const c of task.commits) lines.push(`  commit    ${commitLine(c)}`)
  if (task.question) lines.push(`  question  ${task.question.text} (${task.question.options.join(" / ")})`)
  lines.push(`  epoch     ${task.claimEpoch}`, `  replies   ${task.replyCount} (flockr thread ${task.id})`)
  return lines.join("\n")
}

export const channelLine = (c: Channel) =>
  c.kind === "dm"
    ? `${c.id.padEnd(13)} ${c.unread ? `${c.unread} unread  ` : ""}direct message: ${c.members.join(" and ")}`
    : `#${c.id.padEnd(12)} ${c.visibility === "org" ? "" : `[${c.visibility}] `}${c.unread ? `${c.unread} unread  ` : ""}${c.topic}${c.repo ? `  (${c.repo})` : ""}`

export const memberLine = (m: Member) =>
  `${m.name.padEnd(14)} ${m.kind.padEnd(8)} ${m.org.padEnd(10)} ${m.owner ? `via ${m.owner}` : ""}${m.runsIn ? `  ${m.runsIn}` : ""}${m.source ? `  from ${m.source}` : ""}`

const deletedText = "(message deleted)"

const marks = (m: { labels: string[]; editedAt: string | null }) => `${m.editedAt ? " (edited)" : ""}${m.labels.length ? `  [${m.labels.map((l) => `+${l}`).join(" ")}]` : ""}`

const questionText = (q: ThreadQuestion) => `${q.question.text} [${q.question.options.join(" / ")}]`

export function entryLine(entry: ThreadEntry): string {
  switch (entry.kind) {
    case "event":
      return `${clock(entry.at)}  · ${entry.system ? "" : `${entry.who} `}${entry.text}`
    case "question": {
      const state = entry.answer === null ? `open: flockr answer ${entry.threadId} <option>` : `answered ${entry.answer} by ${entry.answeredBy ?? "someone"}`
      return `${clock(entry.at)}  ${entry.who} asks: ${questionText(entry)}  (${state})`
    }
    case "reply":
      return `${clock(entry.at)}  ${entry.who}: ${entry.deleted ? deletedText : `${entry.text}${marks(entry)}`}  (${entry.id})`
    case "activity":
      return activityEntryLine(entry)
  }
}

export function feedLine(item: FeedItem, tasks: Map<number, Task>): string {
  switch (item.kind) {
    case "event":
      return entryLine(item)
    case "task": {
      const task = tasks.get(item.taskId)
      return `${clock(item.at)}  ${item.who} made task ${task ? taskLine(task) : `#${item.taskId}`}`
    }
    case "ask": {
      const task = tasks.get(item.taskId)
      const q = task?.question
      return `${clock(item.at)}  ${item.who} asks on #${item.taskId}: ${q ? `${q.text} [${q.options.join(" / ")}]` : "(answered)"}`
    }
    case "text": {
      const thread = item.thread ? `  [${item.thread.count} ${item.thread.count === 1 ? "reply" : "replies"}: flockr thread ${item.threadId}]` : item.threadId ? `  (${item.threadId})` : ""
      const task = item.taskId ? `  (about #${item.taskId})` : ""
      return `${clock(item.at)}  ${item.who}: ${item.deleted ? deletedText : `${item.text}${marks(item)}`}${task}${thread}`
    }
  }
}

export function threadText(thread: Thread): string {
  const head = thread.root ? [`#${thread.channel}  ${thread.root.who}: ${thread.root.deleted ? deletedText : `${thread.root.text}${marks(thread.root)}`}`, ""] : [`Thread of task #${thread.taskId} in #${thread.channel}`, ""]
  const { top, under } = splitSubThreads(thread.entries)
  const lines = top.flatMap((entry) => [entryLine(entry), ...(under.get(entry.id) ?? []).map((sub) => `    ${entryLine(sub)}`)])
  return [...head, ...(lines.length ? lines : ["No replies yet."])].join("\n")
}

export const messageStateLine = (m: MessageState) => `${m.id} v${m.version} in ${m.threadId}: ${m.text}${marks(m)}`

export function versionsText(history: MessageVersions): string {
  if (history.deleted) return `${history.id} was deleted; its versions are gone with it.`
  return history.versions.map((v) => `v${v.version}  ${clock(v.at)}  ${v.text}${v.current ? "  (current)" : ""}`).join("\n")
}

export function inboxText(inbox: Inbox): string {
  const questions = [
    ...inbox.questions.map((t) => `  #${t.id} ${t.holder}: ${t.question?.text} [${t.question?.options.join(" / ")}]`),
    ...inbox.threadQuestions.map((q) => `  ${q.threadId} ${q.who} in #${q.channel}: ${questionText(q)}`),
  ]
  const reviews = inbox.reviews.map((t) => `  #${t.id} ${t.title}${lastCommit(t) ? ` (${lastCommit(t)})` : ""} by ${t.holder}`)
  return ["Questions", ...(questions.length ? questions : ["  none"]), "To review", ...(reviews.length ? reviews : ["  none"])].join("\n")
}

export const eventLine = (e: BoardEvent) =>
  `${String(e.seq).padStart(5)}  ${clock(e.at)}  ${e.type.padEnd(22)} ${e.actor}${e.taskId ? ` #${e.taskId}` : ""}${e.channel ? ` #${e.channel}` : ""}${e.messageId ? ` ${e.messageId}` : ""}`

export const activityLine = (a: Activity) => `${a.member} is working in ${a.threadId} (#${a.channel}) since ${clock(a.since)}`

const statusMark = { running: "...", ok: "done", error: "failed", stopped: "stopped" } as const satisfies Record<ActivityEntry["status"], string>

export const activityEntryLine = (entry: ActivityEntry) =>
  `${clock(entry.at)}  ${entry.who} [${statusMark[entry.status]}] ${entry.status === "running" ? currentStep(entry) : entry.title}  (${entry.id}, ${entry.parts.length} parts, rev ${entry.revision}${entry.stopRequestedAt ? ", stop requested" : ""})`

export function activityDetail(entry: ActivityEntry): string {
  const head = activityEntryLine(entry)
  const parts = entry.parts.map((part) => `  ${part.id.padEnd(12)} ${part.type.padEnd(10)} ${partHeadline(part)}`)
  return [head, ...parts].join("\n")
}

const snippetText = (parts: SnippetPart[]) => parts.map((p) => (p.match ? `*${p.text}*` : p.text)).join("").replace(/\s+/g, " ").trim()

export function searchLine(hit: SearchHit): string {
  switch (hit.kind) {
    case "message":
      return `${hit.id.padEnd(6)} #${hit.channel}  ${clock(hit.at)}  ${hit.who}: ${snippetText(hit.snippet)}  (flockr thread ${hit.threadId})`
    case "task":
      return `#${String(hit.id).padEnd(5)} #${hit.channel}  ${hit.state.padEnd(7)}  ${snippetText(hit.snippet)}  (flockr tasks show ${hit.id})`
  }
}

export const areaLine = (a: WorkingArea) =>
  `${String(a.id).padStart(3)}  ${a.owner.padEnd(10)} ${a.paths.join(", ")}  [${a.taskId === null ? `no task, runs out ${clock(a.expiresAt ?? a.createdAt)}` : `#${a.taskId} on ${a.branch}`}${a.note ? `, ${a.note}` : ""}]`

export const overlapLine = (o: AreaOverlap) => `  overlaps ${o.area.owner} (${o.area.taskId === null ? "no task" : `#${o.area.taskId} on ${o.area.branch}`}): ${o.paths.map((p) => `${p.yours} meets ${p.theirs}`).join(", ")}`
