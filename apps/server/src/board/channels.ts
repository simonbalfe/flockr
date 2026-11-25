import type { Channel } from "@flockr/contracts"
import { and, eq, isNull, max } from "drizzle-orm"
import type { Database } from "../db/client"
import { channels, messages, reads } from "../db/schema"
import { alreadyExists } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { requireChannel } from "./read"

export async function createChannel(db: Database, actor: string, id: string, topic: string): Promise<Channel> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const [existing] = await tx.select().from(channels).where(eq(channels.id, id))
    if (existing) throw alreadyExists(`Channel ${id} already exists`)
    await tx.insert(channels).values({ id, topic })
    emit({ type: "channel.created", actor, channel: id, data: { topic } })
    return { id, topic, unread: 0 }
  })
}

export async function markRead(db: Database, actor: string, channel: string): Promise<{ lastReadId: number }> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, channel)
    const [latest] = await tx
      .select({ id: max(messages.id) })
      .from(messages)
      .where(and(eq(messages.channel, channel), isNull(messages.parentId), isNull(messages.threadTaskId)))
    const lastReadId = latest?.id ?? 0
    const [current] = await tx
      .select()
      .from(reads)
      .where(and(eq(reads.member, actor), eq(reads.channel, channel)))
    if (current && current.lastReadId >= lastReadId) return { lastReadId: current.lastReadId }
    await tx
      .insert(reads)
      .values({ member: actor, channel, lastReadId })
      .onConflictDoUpdate({ target: [reads.member, reads.channel], set: { lastReadId } })
    emit({ type: "channel.read", actor, channel, data: { lastReadId } })
    return { lastReadId }
  })
}
