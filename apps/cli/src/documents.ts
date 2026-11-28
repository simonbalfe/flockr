import * as sdk from "@flockr/client"
import type { ChannelDocument, DocumentVersion } from "@flockr/client"
import { run } from "./api"
import { int, need, optionalInt, UsageError } from "./args"
import type { CommandContext } from "./activity"

const channelOf = (raw: string | undefined) => need(raw, "channel").replace(/^#/, "")

export function documentText(doc: ChannelDocument): string {
  if (doc.version === 0) return `#${doc.channel} has no document yet. Write one with flockr doc edit ${doc.channel} --replaces 0 --file plan.md`
  const head = `#${doc.channel} document, version ${doc.version}${doc.current ? "" : " (an earlier version)"} by ${doc.editedBy ?? "someone"} at ${doc.editedAt ?? "?"}${doc.note ? `: ${doc.note}` : ""}`
  const edit = doc.current ? `\n\n(edit with flockr doc edit ${doc.channel} --replaces ${doc.version} --file <path>)` : ""
  return `${head}\n\n${doc.text}${edit}`
}

const versionLine = (v: DocumentVersion) => `v${String(v.version).padEnd(4)} ${v.editedAt}  ${v.editedBy.padEnd(12)} ${String(v.chars).padStart(6)} chars${v.note ? `  ${v.note}` : ""}`

async function newText(values: CommandContext["values"]): Promise<string> {
  if (values.text !== undefined && values.file !== undefined) throw new UsageError("Give --text or --file, not both")
  if (values.text !== undefined) return values.text
  if (values.file === undefined) throw new UsageError("Give the new document with --file <path> (- reads stdin) or --text")
  return values.file === "-" ? Bun.stdin.text() : Bun.file(values.file).text()
}

export async function documentCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const sub = positionals[1] ?? "show"
  switch (sub) {
    case "show": {
      const doc = await run(sdk.getChannelDocument({ path: { channel: channelOf(positionals[2]) }, query: { version: optionalInt(values.version, "--version") } }))
      print(doc, () => documentText(doc))
      return 0
    }
    case "edit": {
      const replaces = int(need(values.replaces, "--replaces (the version you read; flockr doc show prints it)"), "--replaces")
      const body = { text: await newText(values), replaces, note: values.note }
      const doc = await run(sdk.editChannelDocument({ path: { channel: channelOf(positionals[2]) }, body }))
      print(doc, () => `#${doc.channel} document is at version ${doc.version}`)
      return 0
    }
    case "versions": {
      const list = await run(sdk.listDocumentVersions({ path: { channel: channelOf(positionals[2]) } }))
      print(list, () => (list.length ? list.map(versionLine).join("\n") : "No versions yet."))
      return 0
    }
    default:
      throw new UsageError(`Unknown command flockr doc ${sub}`)
  }
}
