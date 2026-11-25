import type { Focus, Task, ThreadQuestion } from "@flockr/client"

export type NeedItem =
  | { kind: "question"; key: string; at: string; who: string; task: Task }
  | { kind: "threadQuestion"; key: string; at: string; who: string; entry: ThreadQuestion }
  | { kind: "review"; key: string; at: string; who: string; task: Task }
  | { kind: "blocked"; key: string; at: string; who: string; task: Task }

const holderOf = (task: Task) => task.holder ?? task.assignee ?? "unassigned"

export function needItems(needsYou: Focus["needsYou"]): NeedItem[] {
  const items: NeedItem[] = [
    ...needsYou.questions.map((task): NeedItem => ({ kind: "question", key: `question-${task.id}`, at: task.createdAt, who: holderOf(task), task })),
    ...needsYou.threadQuestions.map((entry): NeedItem => ({ kind: "threadQuestion", key: `thread-${entry.id}`, at: entry.at, who: entry.who, entry })),
    ...needsYou.reviews.map((task): NeedItem => ({ kind: "review", key: `review-${task.id}`, at: task.createdAt, who: holderOf(task), task })),
    ...needsYou.blocked.map((task): NeedItem => ({ kind: "blocked", key: `blocked-${task.id}`, at: task.createdAt, who: holderOf(task), task })),
  ]
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

export function threadOf(item: NeedItem): string {
  return item.kind === "threadQuestion" ? item.entry.threadId : String(item.task.id)
}
