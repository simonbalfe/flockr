import type { Channel } from "@flockr/contracts"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channels, channelMembers, members } from "../db/schema"
import { canSeeMember, memberSees, viewerOf } from "./visibility"
import { invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember } from "./read"

export async function listedMembersOf(db: Executor, ids: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>()
  if (!ids.length) return grouped
  const rows = await db.select().from(channelMembers).where(inArray(channelMembers.channel, ids)).orderBy(channelMembers.member)
  for (const row of rows) grouped.set(row.channel, [...(grouped.get(row.channel) ?? []), row.member])
  return grouped
}

export async function directPeers(db: Executor, channel: string, actor: string): Promise<string[]> {
  const [row] = await db.select({ kind: channels.kind }).from(channels).where(eq(channels.id, channel))
  if (row?.kind !== "dm") return []
  const rows = await db
    .select({ member: channelMembers.member })
    .from(channelMembers)
    .where(and(eq(channelMembers.channel, channel), ne(channelMembers.member, actor)))
  return rows.map((r) => r.member)
}

export async function seenIn(db: Executor, channel: string, names: string[]): Promise<string[]> {
  if (!names.length) return []
  const rows = await db
    .select({ name: members.name })
    .from(members)
    .where(and(inArray(members.name, names), memberSees(sql`${channel}`, members.name)))
  return names.filter((name) => rows.some((row) => row.name === name))
}

export async function addressedIn(db: Executor, options: { channel: string; actor: string; mentions: string[] }): Promise<{ mentions: string[]; direct: boolean }> {
  const mentions = await seenIn(db, options.channel, options.mentions)
  const peers = await directPeers(db, options.channel, options.actor)
  if (!peers.length) return { mentions, direct: false }
  return { mentions: [...new Set([...mentions, ...peers])], direct: true }
}

async function findDirect(db: Executor, a: string, b: string): Promise<string | undefined> {
  const [row] = await db
    .select({ channel: channelMembers.channel })
    .from(channelMembers)
    .where(inArray(channelMembers.member, [a, b]))
    .groupBy(channelMembers.channel)
    .having(sql`count(*) = 2`)
  return row?.channel
}

async function freeId(tx: Tx, base: string): Promise<string> {
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`
    const [taken] = await tx.select({ id: channels.id }).from(channels).where(eq(channels.id, id))
    if (!taken) return id
  }
}

export async function openDirect(db: Database, actor: string, other: string): Promise<Channel> {
  return mutate(db, async (tx, emit) => {
    const me = await requireActor(tx, actor)
    const them = await findMember(tx, other)
    if (!them) throw notFound(`${other} is not a member of this board`)
    if (them.name === me.name) throw invalid("A direct message needs two different members")
    if (!(await canSeeMember(tx, viewerOf(me.name), them.name))) throw notFound(`${other} is not a member of this board`)
    if (me.kind !== "person" && them.kind !== "person") throw invalid("A direct message needs at least one person")
    if (!["person", "agent"].includes(them.kind) || !["person", "agent"].includes(me.kind)) throw invalid("Direct messages are between people and agents")
    const pair = [me.name, them.name].sort()
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dm:${pair.join(":")}`}))`)
    const existing = await findDirect(tx, me.name, them.name)
    if (existing) return { id: existing, kind: "dm", org: me.org, visibility: "private", members: pair, topic: "", repo: null, unread: 0 }
    const id = await freeId(tx, `dm-${pair.join("-")}`)
    await tx.insert(channels).values({ id, kind: "dm", org: me.org, visibility: "private", topic: "" })
    await tx.insert(channelMembers).values(pair.map((member) => ({ channel: id, member })))
    emit({ type: "channel.created", actor, channel: id, data: { kind: "dm", members: pair } })
    return { id, kind: "dm", org: me.org, visibility: "private", members: pair, topic: "", repo: null, unread: 0 }
  })
}
