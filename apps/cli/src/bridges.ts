import * as sdk from "@flockr/client"
import type { Bridge, ChatBridgeName } from "@flockr/client"
import { run } from "./api"
import { need, UsageError } from "./args"
import type { CommandContext } from "./activity"

export function bridgeText(bridge: Bridge): string {
  const state = bridge.enabled ? "on" : `off: the server has no ${bridge.label} secrets yet`
  const channels = bridge.channels.length ? bridge.channels.map((link) => `  #${link.channel.padEnd(14)} ${link.external}  linked by ${link.linkedBy}`).join("\n") : "  no channels linked"
  const people = bridge.people.length ? bridge.people.map((link) => `  ${link.member.padEnd(15)} ${link.external}`).join("\n") : "  no people linked"
  return `${bridge.label} sync is ${state}\nChannels\n${channels}\nPeople\n${people}\nYou: ${bridge.me ?? `not linked (flockr ${bridge.name} me <your ${bridge.label} user id>)`}`
}

export async function bridgeCommand({ positionals, print }: CommandContext, bridge: ChatBridgeName): Promise<number> {
  const action = positionals[1] ?? "status"
  const show = (result: Bridge) => {
    print(result, () => bridgeText(result))
    return 0
  }
  switch (action) {
    case "status": {
      const { bridges } = await run(sdk.listBridges())
      const found = bridges.find((b) => b.name === bridge)
      if (!found) throw new UsageError(`The board has no ${bridge} bridge`)
      return show(found)
    }
    case "link": {
      const channel = need(positionals[2], "channel").replace(/^#/, "")
      return show(await run(sdk.linkBridgeChannel({ path: { bridge, channel }, body: { external: need(positionals[3], "the platform's channel id") } })))
    }
    case "unlink":
      return show(await run(sdk.unlinkBridgeChannel({ path: { bridge, channel: need(positionals[2], "channel").replace(/^#/, "") } })))
    case "me":
      return show(await run(sdk.linkBridgePerson({ path: { bridge }, body: { external: need(positionals[2], "your user id on the platform") } })))
    case "forget":
      return show(await run(sdk.unlinkBridgePerson({ path: { bridge } })))
    default:
      throw new UsageError(`Unknown ${bridge} command ${action}: use status, link, unlink, me or forget`)
  }
}
