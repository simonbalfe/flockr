import { defaultAgentPermissions, type AgentPermissions } from "@flockr/contracts/agents"

export const toolKinds = ["read", "edit", "command", "other"] as const
export type ToolKind = (typeof toolKinds)[number]

export interface ToolRequest {
  kind: ToolKind
  tool: string
  command: string | null
  input: Record<string, unknown>
}

export type Verdict = "allow" | "ask" | "deny"

export type PermissionRule = Readonly<Record<ToolKind, Verdict>>

export const permissionRules = {
  "edit-free-commands-ask": { read: "allow", edit: "allow", command: "ask", other: "ask" },
  "read-only": { read: "allow", edit: "deny", command: "ask", other: "ask" },
} as const satisfies Record<AgentPermissions, PermissionRule>

export const ruleFor = (permissions: AgentPermissions): PermissionRule => permissionRules[permissions]

export const defaultRule = ruleFor(defaultAgentPermissions)

export const freeCommands = [
  { words: ["flockr"], refused: ["--as", "--url"] },
  { words: ["fc"], refused: ["--as", "--url"] },
  { words: ["git", "status"], refused: [] },
  { words: ["git", "diff"], refused: ["--output", "--ext-diff"] },
  { words: ["git", "log"], refused: ["--output", "--ext-diff"] },
  { words: ["ls"], refused: [] },
] as const

export const permissionOptions = { allow: "Allow once", deny: "Deny" } as const

const outsideQuotes = new Set([";", "&", "|", "<", ">", "(", ")", "`", "$", "\\", "\n", "\r", "*", "?", "~", "{", "}", "!", "#"])
const insideDoubleQuotes = new Set(["`", "$", "\\"])

export function shellWords(command: string): string[] | null {
  const words: string[] = []
  let current = ""
  let started = false
  let quote: "'" | '"' | null = null
  for (const char of command) {
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = null
      else if (insideDoubleQuotes.has(char)) return null
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (char === " " || char === "\t") {
      if (started) words.push(current)
      current = ""
      started = false
      continue
    }
    if (outsideQuotes.has(char)) return null
    current += char
    started = true
  }
  if (quote !== null) return null
  if (started) words.push(current)
  return words
}

export function commandIsFree(command: string): boolean {
  const words = shellWords(command.trim())
  if (!words?.length) return false
  return freeCommands.some((rule) => {
    if (!rule.words.every((word, i) => words[i] === word)) return false
    const rest = words.slice(rule.words.length)
    return !rest.some((word) => rule.refused.some((flag) => word === flag || word.startsWith(`${flag}=`)))
  })
}

export function decide(request: ToolRequest, rule: PermissionRule = defaultRule): Verdict {
  const verdict = rule[request.kind]
  if (verdict !== "ask") return verdict
  if (request.kind === "command" && request.command !== null && commandIsFree(request.command)) return "allow"
  return "ask"
}

export const deniedText = (request: ToolRequest) => `This agent is read only, so ${request.tool} is not allowed. Do not retry it; say in your reply what you would have changed.`

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)

export function questionFor(request: ToolRequest): { text: string; detail: string; options: string[] } {
  const text = request.command === null ? `Allow ${request.tool}?` : `Run \`${clip(request.command.replace(/\s+/g, " "), 160)}\`?`
  return { text, detail: `${request.tool}: ${clip(JSON.stringify(request.input), 1500)}`, options: [permissionOptions.allow, permissionOptions.deny] }
}
