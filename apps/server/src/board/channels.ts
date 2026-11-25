import type { Channel, CreateChannelBody, UpdateChannelBody } from "@flockr/contracts"
import { and, eq, isNull, max } from "drizzle-orm"
import type { Database } from "../db/client"
import { channels, messages, reads } from "../db/schema"
import { alreadyExists, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { listChannels, requireChannel } from "./read"

export async function createChannel(db: Database, actor: string, body: CreateChannelBody): Promise<Channel> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const { id, topic, repo } = body
    const [existing] = await tx.select().from(channels).where(eq(channels.id, id))
    if (existing) throw alreadyExists(`Channel ${id} already exists`)
    await tx.insert(channels).values({ id, topic, repo })
    emit({ type: "channel.created", actor, channel: id, data: { topic, repo } })
    return { id, topic, repo, unread: 0 }
  })
}

export async function updateChannel(db: Database, actor: string, id: string, body: UpdateChannelBody): Promise<Channel> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    const [current] = await tx.select().from(channels).where(eq(channels.id, id)).for("no key update")
    if (!current) throw notFound(`Channel ${id} does not exist`)
    const next = { topic: body.topic ?? current.topic, repo: body.repo === undefined ? current.repo : body.repo }
    if (next.topic !== current.topic || next.repo !== current.repo) {
      await tx.update(channels).set(next).where(eq(channels.id, id))
      emit({ type: "channel.updated", actor, channel: id, data: next })
    }
    const [channel] = (await listChannels(tx, actor)).filter((c) => c.id === id)
    if (!channel) throw notFound(`Channel ${id} does not exist`)
    return channel
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
