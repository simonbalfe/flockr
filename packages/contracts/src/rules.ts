import type { MemberKind } from "./board"

export interface MessageDeleteCheck {
  actor: { name: string; kind: MemberKind }
  author: string
  authorOwner: string | null
}

export const mayDeleteMessage = ({ actor, author, authorOwner }: MessageDeleteCheck): boolean =>
  actor.name === author || actor.kind === "person" || authorOwner === actor.name

export const mayManageAgent = (actor: { kind: MemberKind }): boolean => actor.kind === "person"

export function mentionsIn(text: string, members: ReadonlySet<string>): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/(?<![\w@])@([a-z][a-z0-9-]*)/g)) {
    const name = match[1]
    if (name && members.has(name) && !found.includes(name)) found.push(name)
  }
  return found
}
