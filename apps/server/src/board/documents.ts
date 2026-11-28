import type { ChannelDocument, DocumentVersion, EditDocumentBody } from "@flockr/contracts"
import { and, desc, eq } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channelDocumentVersions, channels, type ChannelDocumentVersionRow } from "../db/schema"
import { BoardError, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { requireChannel } from "./read"

const staleVersion = (message: string) => new BoardError("stale_version", message)

const empty = (channel: string): ChannelDocument => ({ channel, version: 0, text: "", editedBy: null, editedAt: null, note: null, current: true })

const present = (row: ChannelDocumentVersionRow, current: boolean): ChannelDocument => ({
  channel: row.channel,
  version: row.version,
  text: row.body,
  editedBy: row.writtenBy,
  editedAt: row.writtenAt.toISOString(),
  note: row.note,
  current,
})

async function latest(db: Executor, channel: string): Promise<ChannelDocumentVersionRow | undefined> {
  const [row] = await db.select().from(channelDocumentVersions).where(eq(channelDocumentVersions.channel, channel)).orderBy(desc(channelDocumentVersions.version)).limit(1)
  return row
}

export async function getChannelDocument(db: Executor, channel: string, version: number | undefined): Promise<ChannelDocument> {
  await requireChannel(db, channel)
  const head = await latest(db, channel)
  if (version === undefined) return head ? present(head, true) : empty(channel)
  const [row] = await db
    .select()
    .from(channelDocumentVersions)
    .where(and(eq(channelDocumentVersions.channel, channel), eq(channelDocumentVersions.version, version)))
  if (!row) throw notFound(`#${channel}'s document has no version ${version}; it is at version ${head?.version ?? 0}`)
  return present(row, row.version === head?.version)
}

export async function listDocumentVersions(db: Executor, channel: string): Promise<DocumentVersion[]> {
  await requireChannel(db, channel)
  const rows = await db.select().from(channelDocumentVersions).where(eq(channelDocumentVersions.channel, channel)).orderBy(desc(channelDocumentVersions.version))
  return rows.map((row) => ({ version: row.version, editedBy: row.writtenBy, editedAt: row.writtenAt.toISOString(), note: row.note, chars: row.body.length }))
}

async function lockChannel(tx: Tx, channel: string): Promise<void> {
  const [row] = await tx.select({ id: channels.id }).from(channels).where(eq(channels.id, channel)).for("no key update")
  if (!row) throw notFound(`Channel ${channel} does not exist`)
}

const isRetry = (head: ChannelDocumentVersionRow, actor: string, body: EditDocumentBody) => head.writtenBy === actor && head.body === body.text && body.replaces === head.version - 1

export async function editChannelDocument(db: Database, actor: string, channel: string, body: EditDocumentBody): Promise<ChannelDocument> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await lockChannel(tx, channel)
    const head = await latest(tx, channel)
    const current = head?.version ?? 0
    if (head && isRetry(head, actor, body)) return present(head, true)
    if (body.replaces !== current) {
      const who = head ? ` (${head.writtenBy}, ${head.writtenAt.toISOString()})` : ""
      throw staleVersion(`#${channel}'s document is at version ${current}${who}, not ${body.replaces}; read it and edit again`)
    }
    if (head && head.body === body.text) return present(head, true)
    if (!head && body.text === "") return empty(channel)
    const [row] = await tx
      .insert(channelDocumentVersions)
      .values({ channel, version: current + 1, body: body.text, note: body.note ?? null, writtenBy: actor })
      .returning()
    if (!row) throw new Error("Document insert returned nothing")
    emit({ type: "channel.document_edited", actor, channel, data: { version: row.version, replaces: current, note: row.note } })
    return present(row, true)
  })
}
