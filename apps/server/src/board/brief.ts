import { routineLimits, type Brief, type Task, type ThreadQuestion } from "@flockr/contracts"
import { and, asc, eq, gte } from "drizzle-orm"
import type { Executor } from "../db/client"
import { tasks } from "../db/schema"
import { getInbox, presentTasks } from "./read"

const taskRef = (t: Task) => `#${t.id} ${t.title}`

function section(title: string, lines: string[], empty: string): string {
  return lines.length ? [`**${title} (${lines.length})**`, ...lines.map((l) => `- ${l}`)].join("\n") : `**${title}:** ${empty}`
}

export function briefText(parts: { finished: Task[]; blocked: Task[]; questions: Task[]; threadQuestions: ThreadQuestion[]; reviews: Task[] }): string {
  const waiting = [
    ...parts.questions.map((t) => `${t.holder ?? "Someone"} asks on ${taskRef(t)}: ${t.question?.text ?? "a question"}`),
    ...parts.threadQuestions.map((q) => `${q.who} asks in #${q.channel}: ${q.question.text}`),
    ...parts.reviews.map((t) => `Review ${taskRef(t)}${t.holder ? ` from ${t.holder}` : ""}`),
  ]
  return [
    `Morning brief: the last ${routineLimits.briefHours} hours`,
    section("Finished", parts.finished.map(taskRef), "nothing"),
    section("Blocked", parts.blocked.map((t) => `${taskRef(t)}: ${t.reason ?? "no reason given"}`), "nothing"),
    section("Waiting for a person", waiting, "nothing"),
  ].join("\n\n")
}

export async function buildBrief(db: Executor, now = new Date()): Promise<Brief> {
  const since = new Date(now.getTime() - routineLimits.briefHours * 3_600_000)
  const finishedRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.state, "done"), gte(tasks.updatedAt, since)))
    .orderBy(asc(tasks.updatedAt), asc(tasks.id))
  const blockedRows = await db.select().from(tasks).where(eq(tasks.state, "blocked")).orderBy(asc(tasks.id))
  const [finished, blocked, inbox] = await Promise.all([presentTasks(db, finishedRows), presentTasks(db, blockedRows), getInbox(db)])
  const parts = { finished, blocked, questions: inbox.questions, threadQuestions: inbox.threadQuestions, reviews: inbox.reviews }
  return { since: since.toISOString(), until: now.toISOString(), text: briefText(parts), ...parts }
}
