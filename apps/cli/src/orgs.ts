import * as sdk from "@flockr/client"
import { channelVisibilities, type ChannelMember, type ChannelVisibility, type Org } from "@flockr/client"
import type { CommandContext } from "./activity"
import { run } from "./api"
import { need, UsageError } from "./args"
import { channelLine } from "./format"

const orgLine = (o: Org) => `${o.id.padEnd(14)} ${o.name}${o.host ? "  (runs this board)" : ""}`
const channelMemberLine = (m: ChannelMember) => `${m.member.padEnd(14)} ${m.org.padEnd(10)} ${m.addedBy ? `added by ${m.addedBy}` : ""}`
const channelArg = (raw: string | undefined) => need(raw, "channel").replace(/^#/, "")

export function visibilityOf(raw: string | undefined): ChannelVisibility | undefined {
  if (raw === undefined) return undefined
  const found = channelVisibilities.find((v) => v === raw)
  if (!found) throw new UsageError(`--visibility must be one of ${channelVisibilities.join(", ")}`)
  return found
}

export async function orgsCommand(context: CommandContext): Promise<number> {
  const { positionals, print } = context
  const sub = positionals[1] ?? "list"
  switch (sub) {
    case "list": {
      const list = await run(sdk.listOrgs())
      print(list, () => list.map(orgLine).join("\n"))
      return 0
    }
    case "create": {
      const org = await run(sdk.createOrg({ body: { id: need(positionals[2], "org id"), name: need(positionals.slice(3).join(" ").trim() || undefined, "org name") } }))
      print(org, () => orgLine(org))
      return 0
    }
    default:
      throw new UsageError(`Unknown orgs command ${sub}. Use flockr orgs [list|create <id> <name>]`)
  }
}

export async function channelSharingCommand(context: CommandContext, sub: string): Promise<number> {
  const { positionals, print } = context
  const channel = channelArg(positionals[2])
  switch (sub) {
    case "share":
    case "unshare": {
      const updated = await run(sdk.updateChannel({ path: { channel }, body: { visibility: sub === "share" ? "shared" : "org" } }))
      print(updated, () => channelLine(updated))
      return 0
    }
    case "members": {
      const list = await run(sdk.listChannelMembers({ path: { channel } }))
      print(list, () => (list.length ? list.map(channelMemberLine).join("\n") : `#${channel} lists nobody; everyone in its org sees it.`))
      return 0
    }
    case "add":
    case "remove": {
      const path = { channel, name: need(positionals[3], "member") }
      const list = await run(sub === "add" ? sdk.addChannelMember({ path }) : sdk.removeChannelMember({ path }))
      print(list, () => list.map(channelMemberLine).join("\n"))
      return 0
    }
    default:
      throw new UsageError(`Unknown channels command ${sub}`)
  }
}
