import { mayJoinChannel, type ChannelMember, type ChannelVisibility, type CreateOrgBody, type Org } from "@flockr/contracts"
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channelMembers, channels, members, orgs, type ChannelRow, type MemberRow, type OrgRow } from "../db/schema"
import { alreadyExists, forbidden, invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember } from "./read"
import { seesMember, type Viewer } from "./visibility"

const presentOrg = (row: OrgRow): Org => ({ id: row.id, name: row.name, host: row.host })

export async function listOrgs(db: Executor, viewer: Viewer): Promise<Org[]> {
  const rows = await db
    .select()
    .from(orgs)
    .where(sql`exists (select 1 from members om where om.org = ${orgs.id} and om.removed_at is null and ${seesMember(sql`om.name`, viewer)})`)
    .orderBy(asc(orgs.createdAt), asc(orgs.id))
  return rows.map(presentOrg)
}

export async function findOrg(db: Executor, id: string): Promise<OrgRow | undefined> {
  const [row] = await db.select().from(orgs).where(eq(orgs.id, id))
  return row
}

export async function createOrg(db: Database, actor: string, body: CreateOrgBody): Promise<Org> {
  return mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    if (await findOrg(tx, body.id)) throw alreadyExists(`Org ${body.id} already exists`)
    const [row] = await tx.insert(orgs).values({ id: body.id, name: body.name }).returning()
    if (!row) throw new Error("Org insert returned nothing")
    emit({ type: "org.created", actor, data: { id: row.id, name: row.name } })
    return presentOrg(row)
  })
}

async function lockChannel(tx: Tx, id: string): Promise<ChannelRow> {
  const [row] = await tx.select().from(channels).where(eq(channels.id, id)).for("no key update")
  if (!row) throw notFound(`Channel ${id} does not exist`)
  return row
}

function requireOwningOrg(channel: ChannelRow, actor: MemberRow): void {
  if (channel.kind === "dm") throw invalid(`#${channel.id} is a direct message; its members and visibility never change`)
  if (actor.org !== channel.org) throw forbidden(`Only members of org ${channel.org} can change who is in #${channel.id}`)
}

export async function requireVisibilityChange(tx: Tx, channel: ChannelRow, actor: MemberRow, next: ChannelVisibility): Promise<void> {
  if (next === channel.visibility) return
  requireOwningOrg(channel, actor)
  if (next === "shared") return
  const [outside] = await tx
    .select({ member: channelMembers.member })
    .from(channelMembers)
    .innerJoin(members, eq(members.name, channelMembers.member))
    .where(and(eq(channelMembers.channel, channel.id), ne(members.org, channel.org)))
    .limit(1)
  if (outside) throw invalid(`#${channel.id} has members from other orgs (${outside.member}); remove them before it stops being shared`)
}

export async function listChannelMembers(db: Executor, channel: string): Promise<ChannelMember[]> {
  const rows = await db
    .select({ member: channelMembers.member, org: members.org, addedBy: channelMembers.addedBy, addedAt: channelMembers.addedAt })
    .from(channelMembers)
    .innerJoin(members, eq(members.name, channelMembers.member))
    .where(and(eq(channelMembers.channel, channel), isNull(members.removedAt)))
    .orderBy(asc(channelMembers.addedAt), asc(channelMembers.member))
  return rows.map((row) => ({ ...row, addedAt: row.addedAt.toISOString() }))
}

export async function addChannelMember(db: Database, actor: string, channelId: string, name: string): Promise<ChannelMember[]> {
  await mutate(db, async (tx, emit) => {
    const me = await requireActor(tx, actor)
    const channel = await lockChannel(tx, channelId)
    requireOwningOrg(channel, me)
    const member = await findMember(tx, name)
    if (!member) throw notFound(`${name} is not a member of this board`)
    if (!mayJoinChannel(channel, member)) throw invalid(`${name} is in org ${member.org}; set #${channel.id} to shared before adding members from other orgs`)
    const [added] = await tx.insert(channelMembers).values({ channel: channel.id, member: member.name, addedBy: actor }).onConflictDoNothing().returning()
    if (added) emit({ type: "channel.member_added", actor, channel: channel.id, data: { member: member.name, org: member.org } })
  })
  return listChannelMembers(db, channelId)
}

export async function removeChannelMember(db: Database, actor: string, channelId: string, name: string): Promise<ChannelMember[]> {
  await mutate(db, async (tx, emit) => {
    const me = await requireActor(tx, actor)
    const channel = await lockChannel(tx, channelId)
    requireOwningOrg(channel, me)
    const [removed] = await tx
      .delete(channelMembers)
      .where(and(eq(channelMembers.channel, channel.id), eq(channelMembers.member, name)))
      .returning()
    if (removed) emit({ type: "channel.member_removed", actor, channel: channel.id, data: { member: name } })
  })
  return listChannelMembers(db, channelId)
}
