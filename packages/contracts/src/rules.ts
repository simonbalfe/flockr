import type { MemberKind } from "./board"

export interface MessageDeleteCheck {
  actor: { name: string; kind: MemberKind }
  author: string
  authorOwner: string | null
}

export const mayDeleteMessage = ({ actor, author, authorOwner }: MessageDeleteCheck): boolean =>
  actor.name === author || actor.kind === "person" || authorOwner === actor.name

export const mayLabelMessage = mayDeleteMessage

export const mayEditMessage = ({ actor, author }: { actor: { name: string }; author: string }): boolean => actor.name === author

export const labelSet = (labels: readonly string[]): string[] => [...new Set(labels.map((l) => l.trim()).filter(Boolean))]

export const sameLabels = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l) => b.includes(l))

export interface SubThreads<T> {
  top: T[]
  under: Map<string, T[]>
}

export function splitSubThreads<T extends { kind: string }>(entries: readonly T[]): SubThreads<T> {
  const top: T[] = []
  const under = new Map<string, T[]>()
  for (const entry of entries) {
    const parent = "replyTo" in entry && typeof entry.replyTo === "string" ? entry.replyTo : null
    if (parent === null) {
      top.push(entry)
      continue
    }
    under.set(parent, [...(under.get(parent) ?? []), entry])
  }
  return { top, under }
}

export const mayManageAgent = (actor: { kind: MemberKind }): boolean => actor.kind === "person"

export const mayManageRoutine = (actor: { kind: MemberKind }): boolean => actor.kind === "person"

export const mayManageApprovalRules = (actor: { kind: MemberKind }): boolean => actor.kind === "person"
export const mayManageKeys = (actor: { kind: MemberKind }): boolean => actor.kind === "person"

export function mentionsIn(text: string, members: ReadonlySet<string>): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/(?<![\w@])@([a-z][a-z0-9-]*)/gi)) {
    const name = match[1]?.toLowerCase()
    if (name && members.has(name) && !found.includes(name)) found.push(name)
  }
  return found
}

export const actorFields = { org: "actorOrg", kind: "actorKind" } as const

export const wakesAgent = (actor: { kind: string | undefined; org: string | undefined }, agent: { org: string }): boolean =>
  actor.kind !== "agent" || actor.org === undefined || actor.org === agent.org

export const reviewActs = ["approve", "changes"] as const
export type ReviewAct = (typeof reviewActs)[number]

export interface ReviewCheck {
  actor: { name: string; kind: MemberKind }
  task: { id: number; channel: string; holder: string | null; reviewer: string | null }
  reviewNeedsPerson: boolean
  act: ReviewAct
}

export function reviewRefusal({ actor, task, reviewNeedsPerson, act }: ReviewCheck): string | null {
  if (task.holder === actor.name) return `${actor.name} submitted #${task.id}; someone else reviews it`
  if (actor.kind === "person") return null
  if (task.reviewer !== actor.name) return `${actor.name} is not the reviewer of #${task.id}${task.reviewer ? `; ${task.reviewer} is` : "; a person reviews it"}`
  if (act === "approve" && reviewNeedsPerson) return `#${task.channel} needs a person to approve; ${actor.name} can ask for changes or leave a note`
  return null
}

export interface AnswerCheck {
  actor: { name: string; kind: MemberKind }
  question: { to: string | null; permission: boolean }
}

export function answerRefusal({ actor, question }: AnswerCheck): string | null {
  if (question.permission) return actor.kind === "person" ? null : `${actor.name} is not a person; only a person answers a permission card`
  if (question.to !== null) return question.to === actor.name ? null : `This question is for ${question.to}; only ${question.to} answers it`
  return actor.kind === "person" ? null : `${actor.name} is not a person; only a person answers a question addressed to nobody`
}
