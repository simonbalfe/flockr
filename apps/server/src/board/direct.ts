import type { Channel } from "@flockr/contracts"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channels, directMembers } from "../db/schema"
import { forbidden, invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember } from "./read"

export async function directMembersOf(db: Executor, ids: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>()
  if (!ids.length) return grouped
  const rows = await db.select().from(directMembers).where(inArray(directMembers.channel, ids)).orderBy(directMembers.member)
  for (const row of rows) grouped.set(row.channel, [...(grouped.get(row.channel) ?? []), row.member])
  return grouped
}

export async function requireChannelAccess(db: Executor, member: string, channel: string | null): Promise<void> {
  if (channel === null) return
  const [row] = await db.select({ kind: channels.kind }).from(channels).where(eq(channels.id, channel))
  if (!row || row.kind !== "dm") return
  const [mine] = await db
    .select({ member: directMembers.member })
    .from(directMembers)
    .where(and(eq(directMembers.channel, channel), eq(directMembers.member, member)))
  if (!mine) throw forbidden(`#${channel} is a private conversation; only its two members can use it`)
}

export async function directPeers(db: Executor, channel: string, actor: string): Promise<string[]> {
  const [row] = await db.select({ kind: channels.kind }).from(channels).where(eq(channels.id, channel))
  if (row?.kind !== "dm") return []
  const rows = await db
    .select({ member: directMembers.member })
    .from(directMembers)
    .where(and(eq(directMembers.channel, channel), ne(directMembers.member, actor)))
  return rows.map((r) => r.member)
}

export async function addressedIn(db: Executor, options: { channel: string; actor: string; mentions: string[] }): Promise<{ mentions: string[]; direct: boolean }> {
  const peers = await directPeers(db, options.channel, options.actor)
  if (!peers.length) return { mentions: options.mentions, direct: false }
  return { mentions: [...new Set([...options.mentions, ...peers])], direct: true }
}

async function findDirect(db: Executor, a: string, b: string): Promise<string | undefined> {
  const [row] = await db
    .select({ channel: directMembers.channel })
    .from(directMembers)
    .where(inArray(directMembers.member, [a, b]))
    .groupBy(directMembers.channel)
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
    if (me.kind !== "person" && them.kind !== "person") throw invalid("A direct message needs at least one person")
    if (!["person", "agent"].includes(them.kind) || !["person", "agent"].includes(me.kind)) throw invalid("Direct messages are between people and agents")
    const pair = [me.name, them.name].sort()
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dm:${pair.join(":")}`}))`)
    const existing = await findDirect(tx, me.name, them.name)
    if (existing) return { id: existing, kind: "dm", members: pair, topic: "", repo: null, unread: 0 }
    const id = await freeId(tx, `dm-${pair.join("-")}`)
    await tx.insert(channels).values({ id, kind: "dm", topic: "" })
    await tx.insert(directMembers).values(pair.map((member) => ({ channel: id, member })))
    emit({ type: "channel.created", actor, channel: id, data: { kind: "dm", members: pair } })
    return { id, kind: "dm", members: pair, topic: "", repo: null, unread: 0 }
  })
}
