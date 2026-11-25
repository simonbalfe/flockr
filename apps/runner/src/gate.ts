import type { BoardPort } from "./board"
import type { PermissionCodec } from "./harness/types"
import { decide, defaultRule, deniedText, permissionOptions, questionFor, type PermissionRule } from "./permissions"

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
  watch: () => Promise<AnswerWatch>
  log: (line: string) => void
  rule?: PermissionRule
}

export function permissionGate(deps: GateDeps): (args: unknown) => Promise<unknown> {
  const { board, codec, thread } = deps
  return async (args) => {
    const request = codec.read(args)
    if (!request) return codec.deny("The runner could not read this permission request, so it was not run.")
    const verdict = decide(request, deps.rule ?? defaultRule)
    if (verdict === "allow") return codec.allow(request)
    if (verdict === "deny") return codec.deny(deniedText(request))
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
