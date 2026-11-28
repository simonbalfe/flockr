import * as sdk from "@flockr/client"
import { reactionKinds, type FileRef, type Reaction, type ReactionKind } from "@flockr/client"
import { basename } from "node:path"
import { run } from "./api"
import { need, UsageError, type Values } from "./args"
import type { CommandContext } from "./activity"

const isFileId = (value: string) => /^f\d+$/.test(value)

export const fileLine = (f: FileRef) => `${f.id}  ${f.name}  ${f.contentType}  ${f.size} bytes  #${f.channel}${f.messageId ? ` on ${f.messageId}` : ""}`

export const reactionText = (reactions: Reaction[]) => reactions.map((r) => `${r.reaction} ${r.members.join(", ")}`).join("  ")

function reactionOf(raw: string | undefined): ReactionKind {
  const found = reactionKinds.find((k) => k === raw)
  if (!found) throw new UsageError(`Reaction must be one of ${reactionKinds.join(", ")}`)
  return found
}

function encode(bytes: Uint8Array): string {
  let raw = ""
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}

export async function upload(channel: string, path: string, values: Values): Promise<FileRef> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new UsageError(`No file at ${path}`)
  const body = { name: values.name ?? basename(path), contentType: values.type ?? (file.type.split(";")[0] || "application/octet-stream"), data: encode(new Uint8Array(await file.arrayBuffer())) }
  return run(sdk.uploadFile({ path: { channel }, body }))
}

export async function attachmentsFor(channel: string, values: Values): Promise<string[]> {
  const ids: string[] = []
  for (const item of values.attach ?? []) ids.push(isFileId(item) ? item : (await upload(channel, item, values)).id)
  return ids
}

export async function reactCommand({ positionals, print }: CommandContext, on: boolean): Promise<number> {
  const id = need(positionals[1], "message id").replace(/^#/, "")
  const reaction = reactionOf(positionals[2])
  const list = await run(on ? sdk.addReaction({ path: { id, reaction } }) : sdk.removeReaction({ path: { id, reaction } }))
  print(list, () => (list.length ? reactionText(list) : "No reactions."))
  return 0
}

export async function uploadCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const file = await upload(need(positionals[1], "channel").replace(/^#/, ""), need(positionals[2], "file path"), values)
  print(file, () => `Uploaded ${fileLine(file)}; attach it with --attach ${file.id}`)
  return 0
}

export async function downloadCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const content = await run(sdk.getFileContent({ path: { id: need(positionals[1], "file id") } }))
  const out = values.out ?? content.file.name
  await Bun.write(out, Uint8Array.from(atob(content.data), (c) => c.charCodeAt(0)))
  print(content.file, () => `Wrote ${out} (${content.file.size} bytes)`)
  return 0
}
