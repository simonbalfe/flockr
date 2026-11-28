import type { Channel, CreateChannelBody, MarkReadQuery, UpdateChannelBody } from "@flockr/contracts"
import { and, eq, isNull, lte, max } from "drizzle-orm"
import type { Database } from "../db/client"
import { channelMembers, channels, messages, reads } from "../db/schema"
import { alreadyExists, forbidden, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { requireVisibilityChange } from "./orgs"
import { listChannels, parseThreadId, requireChannel } from "./read"
import { viewerOf } from "./visibility"

export async function createChannel(db: Database, actor: string, body: CreateChannelBody): Promise<Channel> {
  return mutate(db, async (tx, emit) => {
    const me = await requireActor(tx, actor)
    const { id, topic, repo, visibility } = body
    const [existing] = await tx.select().from(channels).where(eq(channels.id, id))
    if (existing) throw alreadyExists(`Channel ${id} already exists`)
    await tx.insert(channels).values({ id, topic, repo, org: me.org, visibility })
    const listed = visibility === "private" ? [me.name] : []
    if (listed.length) await tx.insert(channelMembers).values(listed.map((member) => ({ channel: id, member, addedBy: actor })))
    emit({ type: "channel.created", actor, channel: id, data: { topic, repo, org: me.org, visibility } })
    return { id, kind: "channel", org: me.org, visibility, members: listed, topic, repo, reviewNeedsPerson: false, unread: 0 }
  })
}

export async function updateChannel(db: Database, actor: string, id: string, body: UpdateChannelBody): Promise<Channel> {
  return mutate(db, async (tx, emit) => {
    const me = await requireActor(tx, actor)
    const [current] = await tx.select().from(channels).where(eq(channels.id, id)).for("no key update")
    if (!current) throw notFound(`Channel ${id} does not exist`)
    const next = {
      topic: body.topic ?? current.topic,
      repo: body.repo === undefined ? current.repo : body.repo,
      visibility: body.visibility ?? current.visibility,
      reviewNeedsPerson: body.reviewNeedsPerson ?? current.reviewNeedsPerson,
    }
    await requireVisibilityChange(tx, current, me, next.visibility)
    if (next.reviewNeedsPerson !== current.reviewNeedsPerson && (me.kind !== "person" || me.org !== current.org)) {
      throw forbidden(`Only a person in org ${current.org} decides who approves tasks in #${id}`)
    }
    if (next.topic !== current.topic || next.repo !== current.repo || next.visibility !== current.visibility || next.reviewNeedsPerson !== current.reviewNeedsPerson) {
      await tx.update(channels).set(next).where(eq(channels.id, id))
      emit({ type: "channel.updated", actor, channel: id, data: next })
    }
    const [channel] = (await listChannels(tx, viewerOf(actor))).filter((c) => c.id === id)
    if (!channel) throw notFound(`Channel ${id} does not exist`)
    return channel
  })
}

export async function markRead(db: Database, actor: string, channel: string, query: MarkReadQuery = {}): Promise<{ lastReadId: number }> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await requireChannel(tx, channel)
    const upTo = query.upTo === undefined ? null : parseThreadId(query.upTo)
    const until = upTo?.kind === "message" ? lte(messages.id, upTo.id) : undefined
    const [latest] = await tx
      .select({ id: max(messages.id) })
      .from(messages)
      .where(and(eq(messages.channel, channel), isNull(messages.parentId), isNull(messages.threadTaskId), until))
    const lastReadId = latest?.id ?? 0
    const [current] = await tx
      .select()
      .from(reads)
      .where(and(eq(reads.member, actor), eq(reads.channel, channel)))
    if (current && current.lastReadId >= lastReadId) return { lastReadId: current.lastReadId }
    await tx
      .insert(reads)
      .values({ member: actor, channel, lastReadId, readAt: new Date() })
      .onConflictDoUpdate({ target: [reads.member, reads.channel], set: { lastReadId, readAt: new Date() } })
    emit({ type: "channel.read", actor, channel, data: { lastReadId, upTo: query.upTo ?? null } })
    return { lastReadId }
  })
}
