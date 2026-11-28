import * as sdk from "@flockr/client"
import { blockKinds, blockSummary, PostableBlockSchema, type BlockRecord, type PostableBlock } from "@flockr/client"
import { run } from "./api"
import { need, optionalInt, UsageError, type Values } from "./args"
import type { CommandContext } from "./activity"

function parseBlock(raw: string): PostableBlock {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new UsageError(`--block must be JSON, got ${raw.slice(0, 60)}`)
  }
  const parsed = PostableBlockSchema.safeParse(value)
  if (!parsed.success) throw new UsageError(`--block is not a deliverable or decision block: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
  return parsed.data
}

export function blocksFrom(values: Values): PostableBlock[] {
  const given = (values.block ?? []).map(parseBlock)
  if (values.why !== undefined && values.decision === undefined) throw new UsageError("--why goes with --decision")
  const decision = values.decision === undefined ? [] : [parseBlock(JSON.stringify({ kind: "decision", decision: values.decision, why: values.why ?? null }))]
  return [...given, ...decision]
}

const recordLine = (r: BlockRecord) => `${r.at.slice(0, 16).replace("T", " ")}  ${r.who.padEnd(10)} ${r.messageId.padEnd(6)} ${blockSummary(r.block)}`

export async function blocksCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const channel = need(positionals[1], "channel").replace(/^#/, "")
  const kind = values.kind === undefined ? undefined : blockKinds.find((k) => k === values.kind)
  if (values.kind !== undefined && !kind) throw new UsageError(`--kind must be one of ${blockKinds.join(", ")}`)
  const list = await run(sdk.listBlocks({ path: { channel }, query: { kind, task: optionalInt(values.task, "--task") } }))
  print(list, () => (list.length ? list.map(recordLine).join("\n") : "No blocks."))
  return 0
}
