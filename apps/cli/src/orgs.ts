import * as sdk from "@flockr/client"
import { channelVisibilities, profileColours, type ChannelMember, type ChannelVisibility, type Invite, type Org } from "@flockr/client"
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

const inviteLine = (i: Invite) => `${String(i.id).padStart(4)}  ${i.state.padEnd(8)} ${i.email.padEnd(28)} as ${i.name} in ${i.org}, by ${i.invitedBy}, until ${i.expiresAt.slice(0, 10)}`

export async function invitesCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  switch (sub) {
    case "list": {
      const list = await run(sdk.listInvites())
      print(list, () => (list.length ? list.map(inviteLine).join("\n") : "No invites."))
      return 0
    }
    case "create": {
      const invite = await run(sdk.createInvite({ body: { email: need(positionals[2], "email"), name: need(values.name, "--name"), org: need(values.org, "--org") } }))
      print(invite, () => `Invited ${invite.email} as ${invite.name} in ${invite.org}; they sign in with that address until ${invite.expiresAt.slice(0, 10)}`)
      return 0
    }
    case "revoke": {
      const invite = await run(sdk.revokeInvite({ path: { id: Number(need(positionals[2], "invite id")) } }))
      print(invite, () => inviteLine(invite))
      return 0
    }
    default:
      throw new UsageError(`Unknown invites command ${sub}. Use flockr invites [list|create <email> --name n --org o|revoke <id>]`)
  }
}

const textOrClear = (value: string | undefined) => (value === undefined ? undefined : value.trim() || null)

export async function profileCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const name = need(positionals[1], "member")
  const colour = values.colour === undefined ? undefined : values.colour === "" ? null : profileColours.find((c) => c === values.colour)
  if (colour === undefined && values.colour !== undefined) throw new UsageError(`--colour must be one of ${profileColours.join(", ")}`)
  const body = { displayName: textOrClear(values["display-name"]), about: textOrClear(values.about), colour }
  if (Object.values(body).every((v) => v === undefined)) {
    const member = (await run(sdk.listMembers())).find((m) => m.name === name)
    if (!member) throw new UsageError(`No member ${name}`)
    print(member, () => [`${member.displayName ?? member.name} (${member.name})`, `  ${member.kind} in ${member.org}${member.owner ? `, owner ${member.owner}` : ""}`, ...(member.about ? [`  ${member.about}`] : []), ...(member.colour ? [`  colour ${member.colour}`] : [])].join("\n"))
    return 0
  }
  const member = await run(sdk.updateProfile({ path: { name }, body }))
  print(member, () => `${member.name}: ${member.displayName ?? "(no display name)"}${member.about ? `, ${member.about}` : ""}${member.colour ? `, ${member.colour}` : ""}`)
  return 0
}
