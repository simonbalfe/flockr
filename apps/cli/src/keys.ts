import * as sdk from "@flockr/client"
import type { MemberKey } from "@flockr/client"
import type { CommandContext } from "./activity"
import { run } from "./api"
import { need, UsageError } from "./args"

const keyLine = (k: MemberKey) =>
  [
    k.id.padEnd(16),
    `${k.shown}...`.padEnd(12),
    `${k.member}${k.owner ? ` via ${k.owner}` : ""}`.padEnd(20),
    (k.channels ? k.channels.map((c) => `#${c}`).join(",") : "all channels").padEnd(20),
    k.revokedAt ? `revoked ${k.revokedAt}` : k.lastUsedAt ? `last used ${k.lastUsedAt}` : "never used",
  ].join(" ")

const channelsOf = (raw: string | undefined) => (raw === undefined ? null : raw.split(",").map((c) => c.trim().replace(/^#/, "")).filter((c) => c !== ""))

export async function keysCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  switch (sub) {
    case "list": {
      const list = await run(sdk.listKeys())
      print(list, () => (list.length ? list.map(keyLine).join("\n") : "No keys yet. flockr keys create <member> makes one."))
      return 0
    }
    case "create": {
      const channels = channelsOf(values.channels)
      if (channels?.length === 0) throw new UsageError("--channels needs at least one channel: --channels backend,platform")
      const created = await run(sdk.createKey({ body: { member: need(positionals[2], "member"), channels } }))
      print(created, () => `${keyLine(created.key)}\n\n${created.secret}\n\nThis is the only time the key is shown. Give it to ${created.key.member} as FLOCKR_KEY, or as key in ~/.flockr/runner.json.`)
      return 0
    }
    case "revoke": {
      const revoked = await run(sdk.revokeKey({ path: { id: need(positionals[2], "key id") } }))
      print(revoked, () => keyLine(revoked))
      return 0
    }
    default:
      throw new UsageError(`Unknown keys command ${sub}. Use flockr keys [list|create <member> [--channels a,b]|revoke <id>]`)
  }
}
