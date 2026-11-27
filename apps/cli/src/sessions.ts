import * as sdk from "@flockr/client"
import type { SavedSession, SessionSummary } from "@flockr/client"
import { run } from "./api"
import { need, optionalInt, UsageError } from "./args"
import type { CommandContext } from "./activity"
import { envMember } from "./config"

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export const sessionLine = (s: SessionSummary): string =>
  `${s.session.padEnd(38)} ${String(s.turns).padStart(4)} turns ${size(s.bytes).padStart(9)}  ${s.fence}${s.thread ? `  thread ${s.thread}` : ""}  saved ${s.updatedAt.slice(0, 16).replace("T", " ")}`

export const sessionDetail = (s: SavedSession): string =>
  [
    `${s.agent} session ${s.session}: ${s.turns} turns, ${size(s.bytes)}, fenced by ${s.fence}${s.taskId === null ? "" : ` (task #${s.taskId})`}${s.thread ? `, thread ${s.thread}` : ""}`,
    ...s.chunks.map((c) => `  turn ${String(c.turn).padStart(4)}  ${c.fence.padEnd(18)} ${size(c.bytes).padStart(9)}  ${c.savedAt.slice(0, 19).replace("T", " ")}  ${c.sha256.slice(0, 12)}`),
  ].join("\n")

export async function sessionsCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  switch (sub) {
    case "list": {
      const name = positionals[2] ?? values.agent ?? values.as ?? envMember
      const list = await run(sdk.listSavedSessions({ path: { name }, query: { thread: values.thread?.replace(/^#/, ""), limit: optionalInt(values.limit, "--limit") } }))
      print(list, () => (list.length ? list.map(sessionLine).join("\n") : `${name} has no saved sessions yet.`))
      return 0
    }
    case "show": {
      const name = need(positionals[2], "agent")
      const session = need(positionals[3], "session")
      const found = await run(sdk.getSavedSession({ path: { name, session } }))
      print(found, () => sessionDetail(found))
      return 0
    }
    default:
      throw new UsageError(`Unknown command flockr sessions ${sub}; try flockr sessions list <agent> or flockr sessions show <agent> <session>`)
  }
}
