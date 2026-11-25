import * as sdk from "@flockr/client"
import { run } from "./api"
import type { CommandContext } from "./activity"
import { int, need, UsageError } from "./args"
import { areaLine, overlapLine } from "./format"

export interface AreasContext extends CommandContext {
  epochFor: (id: number) => number | undefined
}

const channelOf = (raw: string | undefined) => need(raw, "channel").replace(/^#/, "")

export async function areasCommand(context: AreasContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  switch (sub) {
    case "list": {
      const channel = channelOf(positionals[2] ?? values.channel)
      const areas = await run(sdk.listAreas({ path: { channel } }))
      print(areas, () => (areas.length ? areas.map(areaLine).join("\n") : `Nobody has declared a working area in #${channel}.`))
      return 0
    }
    case "declare": {
      const channel = channelOf(positionals[2])
      const paths = positionals.slice(3)
      if (!paths.length) throw new UsageError("Give at least one path: flockr areas declare <channel> <path>... [--task id] [--note text] [--refuse]")
      const taskId = values.task === undefined ? undefined : int(values.task, "--task")
      const body = { paths, taskId, note: values.note, overlap: values.refuse ? ("refuse" as const) : ("warn" as const), epoch: taskId === undefined ? undefined : context.epochFor(taskId) }
      const result = await run(sdk.declareArea({ path: { channel }, body }))
      print(result, () => [`Declared ${areaLine(result.area)}`, ...result.overlaps.map(overlapLine), ...(result.overlaps.length ? ["Pick other work or ask them before editing these paths."] : [])].join("\n"))
      return 0
    }
    case "renew":
    case "release": {
      const path = { channel: channelOf(positionals[2]), id: int(positionals[3], "area id") }
      const area = await run(sub === "renew" ? sdk.renewArea({ path }) : sdk.releaseArea({ path }))
      print(area, () => `${sub === "renew" ? "Renewed" : "Released"} ${areaLine(area)}`)
      return 0
    }
    default:
      throw new UsageError(`Unknown command flockr areas ${sub}`)
  }
}
