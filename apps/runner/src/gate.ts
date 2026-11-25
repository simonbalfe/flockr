import { defaultAgentPermissions, type AgentPermissions } from "@flockr/contracts/agents"
import type { BoardPort } from "./board"
import type { PermissionCodec } from "./harness/types"
import { blockedText, consultsBoard, decide, deniedText, permissionOptions, questionFor, ruleFor, withBoard, type ToolRequest, type Verdict } from "./permissions"

export interface Answer {
  option: string
  by: string
}

export interface AnswerWatch {
  answerTo: (questionId: string) => Promise<Answer>
  close: () => void
}

export interface GateDeps {
  board: BoardPort
  codec: PermissionCodec
  thread: string
  channel: string
  watch: () => Promise<AnswerWatch>
  log: (line: string) => void
  permissions?: AgentPermissions
}

async function verdictOf(deps: GateDeps, request: ToolRequest): Promise<{ verdict: Verdict; denied: string }> {
  const permissions = deps.permissions ?? defaultAgentPermissions
  const own = decide(request, ruleFor(permissions))
  if (!consultsBoard(request, own)) return { verdict: own, denied: deniedText(request) }
  const board = await deps.board.approval("command", deps.channel)
  return { verdict: withBoard(permissions, board), denied: blockedText(request) }
}

export function permissionGate(deps: GateDeps): (args: unknown) => Promise<unknown> {
  const { board, codec, thread } = deps
  return async (args) => {
    const request = codec.read(args)
    if (!request) return codec.deny("The runner could not read this permission request, so it was not run.")
    const { verdict, denied } = await verdictOf(deps, request)
    if (verdict === "allow") return codec.allow(request)
    if (verdict === "deny") return codec.deny(denied)
    const watch = await deps.watch()
    try {
      const asked = await board.ask(thread, questionFor(request))
      if (asked.kind === "refused") return codec.deny(`${asked.reason}. It was not run; say in the thread what you needed.`)
      deps.log(`asked in ${thread}: ${asked.question.question.text}`)
      const answer = await watch.answerTo(asked.question.id)
      if (answer.option === permissionOptions.allow) return codec.allow(request)
      return codec.deny(`${answer.by} denied this on the board. Do not retry it; say in your reply what you could not do.`)
    } finally {
      watch.close()
    }
  }
}
