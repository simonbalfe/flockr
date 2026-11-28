import * as sdk from "@flockr/client"
import type { ScheduledPost } from "@flockr/client"
import { run } from "./api"
import { need, UsageError } from "./args"
import type { CommandContext } from "./activity"
import { clock } from "./format"

const units = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const

export function timeOf(raw: string, now = Date.now()): string {
  const relative = /^\+(\d+)([mhd])$/.exec(raw)
  if (relative) {
    const unit = relative[2]
    const step = unit === "m" || unit === "h" || unit === "d" ? units[unit] : 0
    return new Date(now + Number(relative[1]) * step).toISOString()
  }
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) throw new UsageError(`--at must be a time such as 2026-11-30T09:00:00Z or +30m, +2h, +1d; got ${raw}`)
  return at.toISOString()
}

const line = (s: ScheduledPost) => `${s.id.padEnd(6)} #${s.channel.padEnd(12)} ${s.at.slice(0, 16).replace("T", " ")} (${clock(s.at)} local)  ${s.state}  ${s.text}`

export async function scheduleCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const channel = need(positionals[1], "channel").replace(/^#/, "")
  const text = positionals.slice(2).join(" ")
  if (!text) throw new UsageError("Missing text")
  const scheduled = await run(sdk.schedulePost({ path: { channel }, body: { text, at: timeOf(need(values.at, "--at")), key: values.key } }))
  print(scheduled, () => `Scheduled ${scheduled.id} for ${scheduled.at}; cancel with flockr scheduled cancel ${channel} ${scheduled.id}`)
  return 0
}

export async function scheduledCommand({ positionals, print }: CommandContext): Promise<number> {
  if (positionals[1] === "cancel") {
    const channel = need(positionals[2], "channel").replace(/^#/, "")
    const canceled = await run(sdk.cancelScheduledPost({ path: { channel, id: need(positionals[3], "scheduled post id (j12)") } }))
    print(canceled, () => line(canceled))
    return 0
  }
  const list = await run(sdk.listScheduledPosts())
  print(list, () => (list.length ? list.map(line).join("\n") : "Nothing scheduled."))
  return 0
}
