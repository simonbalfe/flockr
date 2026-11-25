import { activitySeconds, type Activity, type LiveFrame } from "@flockr/contracts"
import { and, asc, eq, gt } from "drizzle-orm"
import type { Database, Executor } from "../db/client"
import { activity, type ActivityRow } from "../db/schema"
import { liveSignals } from "../platform"
import { requireActor } from "./members"
import { findMessage, parseThreadId, findTask, messageKey } from "./read"
import { visibleTo } from "./visibility"

function present(row: ActivityRow): Activity {
  return { member: row.member, threadId: row.threadId, channel: row.channel, since: row.since.toISOString(), expiresAt: row.expiresAt.toISOString() }
}

async function threadPlace(db: Executor, raw: string): Promise<{ key: string; channel: string }> {
  const ref = parseThreadId(raw)
  if (ref.kind === "task") {
    const task = await findTask(db, ref.id)
    return { key: String(task.id), channel: task.channel }
  }
  const message = await findMessage(db, ref.id)
  const root = message.parentId ?? message.id
  return { key: messageKey(root), channel: message.channel }
}

export async function setActivity(db: Database, actor: string, threadId: string, working: boolean, now = new Date()): Promise<Activity | null> {
  return db.transaction(async (tx) => {
    await requireActor(tx, actor)
    const place = await threadPlace(tx, threadId)
    const expiresAt = new Date(now.getTime() + activitySeconds * 1000)
    const where = and(eq(activity.member, actor), eq(activity.threadId, place.key))
    const [row] = working
      ? await tx
          .insert(activity)
          .values({ member: actor, threadId: place.key, channel: place.channel, since: now, expiresAt })
          .onConflictDoUpdate({ target: [activity.member, activity.threadId], set: { expiresAt } })
          .returning()
      : await tx.delete(activity).where(where).returning()
    const current = row ? present(row) : { member: actor, threadId: place.key, channel: place.channel, since: now.toISOString(), expiresAt: now.toISOString() }
    const frame: LiveFrame = { kind: "activity", activity: current, working }
    await liveSignals.publish(tx, { kind: "frame", frame })
    return working && row ? current : null
  })
}

export async function listActivity(db: Executor, viewer: string | null, now = new Date()): Promise<Activity[]> {
  const rows = await db.select().from(activity).where(and(gt(activity.expiresAt, now), visibleTo(activity.channel, viewer))).orderBy(asc(activity.since))
  return rows.map(present)
}
