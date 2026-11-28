import { fileKey, fileLimits, type FileContent, type FileRef, type Reaction, type ReactionKind, type UploadFileBody } from "@flockr/contracts"
import { and, eq } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { files, messageReactions, type FileRow } from "../db/schema"
import type { ObjectStore } from "../storage/store"
import { invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { fileId, findMessage, messageKey, parseThreadId, presentFile, reactionsFor, requireChannel, threadKeyOf } from "./read"

function requireStore(store: ObjectStore | null): ObjectStore {
  if (!store) throw invalid("This board has no file store; set FLOCKR_S3_* or run it with a local folder")
  return store
}

function decode(data: string): Uint8Array {
  let raw: string
  try {
    raw = atob(data)
  } catch {
    throw invalid("data is not base64")
  }
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function encode(bytes: Uint8Array): string {
  let raw = ""
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}

async function messageOf(db: Executor, raw: string) {
  const ref = parseThreadId(raw)
  if (ref.kind === "task") throw invalid(`${raw} is a task; react to a message or reply such as m12`)
  const row = await findMessage(db, ref.id)
  if (row.kind !== "text") throw invalid(`${raw} is not a message or reply`)
  if (row.deletedAt) throw invalid(`${raw} was deleted`)
  return row
}

export async function setReaction(db: Database, actor: string, raw: string, reaction: ReactionKind, on: boolean): Promise<Reaction[]> {
  await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const row = await messageOf(tx, raw)
    const changed = on
      ? await tx.insert(messageReactions).values({ messageId: row.id, member: actor, reaction }).onConflictDoNothing().returning()
      : await tx
          .delete(messageReactions)
          .where(and(eq(messageReactions.messageId, row.id), eq(messageReactions.member, actor), eq(messageReactions.reaction, reaction)))
          .returning()
    if (!changed.length) return
    emit({ type: on ? "reaction.added" : "reaction.removed", actor, channel: row.channel, taskId: row.threadTaskId ?? row.taskId, threadId: threadKeyOf(row), messageId: messageKey(row.id), data: { reaction } })
  })
  const row = await messageOf(db, raw)
  return (await reactionsFor(db, [row.id])).get(row.id) ?? []
}

export async function uploadFile(db: Database, store: ObjectStore | null, actor: string, channel: string, body: UploadFileBody): Promise<FileRef> {
  const objects = requireStore(store)
  await requireActor(db, actor)
  await requireChannel(db, channel)
  const bytes = decode(body.data)
  if (bytes.length > fileLimits.bytes) throw invalid(`${body.name} is ${bytes.length} bytes; a file is at most ${fileLimits.bytes}`)
  const objectKey = `files/${channel}/${crypto.randomUUID()}`
  await objects.put(objectKey, bytes, body.contentType)
  return mutate(db, async (tx, emit) => {
    const [row] = await tx.insert(files).values({ channel, uploadedBy: actor, name: body.name, contentType: body.contentType, size: bytes.length, objectKey }).returning()
    if (!row) throw new Error("File insert returned nothing")
    emit({ type: "file.uploaded", actor, channel, data: { file: fileId(row.id), name: row.name, size: row.size } })
    return presentFile(row)
  })
}

export async function attachFiles(tx: Tx, options: { actor: string; channel: string; messageId: number; ids: string[] }): Promise<void> {
  for (const raw of options.ids) {
    const [row] = await tx.select().from(files).where(eq(files.id, Number(fileKey(raw)))).for("update")
    if (!row || row.channel !== options.channel) throw invalid(`File ${raw} is not in #${options.channel}; upload it there first`)
    if (row.uploadedBy !== options.actor) throw invalid(`File ${raw} was uploaded by ${row.uploadedBy}; attach your own files`)
    if (row.messageId !== null && row.messageId !== options.messageId) throw invalid(`File ${raw} is already attached to ${messageKey(row.messageId)}`)
    await tx.update(files).set({ messageId: options.messageId }).where(eq(files.id, row.id))
  }
}

export async function findFile(db: Executor, raw: string): Promise<FileRow> {
  const [row] = await db.select().from(files).where(eq(files.id, Number(fileKey(raw))))
  if (!row) throw notFound(`File ${raw} does not exist`)
  return row
}

export async function fileBytes(db: Executor, store: ObjectStore | null, raw: string): Promise<{ row: FileRow; bytes: Uint8Array }> {
  const row = await findFile(db, raw)
  const bytes = await requireStore(store).get(row.objectKey)
  if (!bytes) throw notFound(`File ${raw} is missing from the store`)
  return { row, bytes }
}

export async function fileContent(db: Executor, store: ObjectStore | null, raw: string): Promise<FileContent> {
  const { row, bytes } = await fileBytes(db, store, raw)
  return { file: presentFile(row), data: encode(bytes) }
}

export async function channelOfFile(db: Executor, raw: string): Promise<string | null> {
  const key = fileKey(raw)
  if (key === undefined) return null
  const [row] = await db.select({ channel: files.channel }).from(files).where(eq(files.id, Number(key)))
  return row?.channel ?? null
}
