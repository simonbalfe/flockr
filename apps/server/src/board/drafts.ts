import type { Draft, DraftKind, SaveDraftBody, SaveDraftResult } from "@flockr/contracts"
import { and, desc, eq } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { drafts, type DraftRow } from "../db/schema"
import { requireChannelAccess } from "./direct"
import { requireActor } from "./members"
import { findMessage, findTask, messageKey, parseThreadId, requireChannel } from "./read"
import { visibleTo } from "./visibility"

interface DraftKey {
  member: string
  kind: DraftKind
  target: string
}

export function present(row: DraftRow): Draft {
  return { kind: row.kind, target: row.target, channel: row.channel, text: row.text, updatedAt: row.updatedAt.toISOString() }
}

export async function clearDraft(tx: Tx, key: DraftKey): Promise<void> {
  await tx.delete(drafts).where(and(eq(drafts.member, key.member), eq(drafts.kind, key.kind), eq(drafts.target, key.target)))
}

async function placeOf(db: Executor, body: SaveDraftBody): Promise<{ target: string; channel: string }> {
  if (body.kind === "channel") {
    await requireChannel(db, body.target)
    return { target: body.target, channel: body.target }
  }
  const ref = parseThreadId(body.target)
  if (ref.kind === "task") return { target: String(ref.id), channel: (await findTask(db, ref.id)).channel }
  return { target: messageKey(ref.id), channel: (await findMessage(db, ref.id)).channel }
}

export async function saveDraft(db: Database, actor: string, body: SaveDraftBody): Promise<SaveDraftResult> {
  return db.transaction(async (tx) => {
    await requireActor(tx, actor)
    const place = await placeOf(tx, body)
    await requireChannelAccess(tx, actor, place.channel)
    if (body.text.trim() === "") {
      await clearDraft(tx, { member: actor, kind: body.kind, target: place.target })
      return { draft: null }
    }
    const [row] = await tx
      .insert(drafts)
      .values({ member: actor, kind: body.kind, target: place.target, channel: place.channel, text: body.text })
      .onConflictDoUpdate({ target: [drafts.member, drafts.kind, drafts.target], set: { text: body.text, channel: place.channel, updatedAt: new Date() } })
      .returning()
    if (!row) throw new Error("Draft upsert returned nothing")
    return { draft: present(row) }
  })
}

export async function listDrafts(db: Executor, actor: string): Promise<Draft[]> {
  const rows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.member, actor), visibleTo(drafts.channel, actor)))
    .orderBy(desc(drafts.updatedAt))
  return rows.map(present)
}
