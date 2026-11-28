import { sql, type AnyColumn, type SQL } from "drizzle-orm"
import type { Executor } from "../db/client"
import { forbidden } from "./errors"

export interface Viewer {
  member: string
  channels: string[] | null
  key?: { id: string; version: number }
}

export const viewerOf = (member: string, channels: string[] | null = null): Viewer => ({ member, channels })

type Name = string | AnyColumn | SQL

const orgOf = (member: Name) => sql`(select vm.org from members vm where vm.name = ${member} and vm.removed_at is null)`

const inLimit = (channel: AnyColumn | SQL, limit: string[] | null): SQL =>
  limit === null ? sql`true` : sql`${channel} in (${sql.join(limit.map((id) => sql`${id}`), sql`, `)})`

const seesChannelAs = (channel: AnyColumn | SQL, member: Name, limit: string[] | null): SQL =>
  sql`exists (
    select 1 from channels vc
    where vc.id = ${channel} and ${inLimit(sql`vc.id`, limit)}
      and (
        exists (select 1 from channel_members vcm where vcm.channel = vc.id and vcm.member = ${member})
        or (vc.visibility <> 'private' and vc.org = ${orgOf(member)})
      )
  )`

const seesChannel = (channel: AnyColumn | SQL, viewer: Viewer): SQL => seesChannelAs(channel, viewer.member, viewer.channels)

export const memberSees = (channel: AnyColumn | SQL, member: AnyColumn | SQL): SQL => seesChannelAs(channel, member, null)

export const inHostOrg = (viewer: Viewer): SQL =>
  viewer.channels === null ? sql`exists (select 1 from orgs vo where vo.host and vo.id = ${orgOf(viewer.member)})` : sql`false`

export const visibleTo = (channel: AnyColumn | SQL, viewer: Viewer): SQL =>
  sql`(case when ${channel} is null then ${inHostOrg(viewer)} else ${seesChannel(channel, viewer)} end)`

export const sameOrgChannel = (channel: AnyColumn | SQL, viewer: Viewer): SQL =>
  viewer.channels === null ? sql`exists (select 1 from channels vc where vc.id = ${channel} and vc.org = ${orgOf(viewer.member)})` : sql`false`

export const seesMember = (member: AnyColumn | SQL, viewer: Viewer): SQL =>
  sql`(
    (${viewer.channels === null ? sql`true` : sql`false`} and exists (select 1 from members vt where vt.name = ${member} and vt.org = ${orgOf(viewer.member)}))
    or ${member} = ${viewer.member}
    or exists (
      select 1 from channels sc
      where ${seesChannel(sql`sc.id`, viewer)} and ${memberSees(sql`sc.id`, member)}
    )
  )`

export const seenByAll = (channel: AnyColumn | SQL, audience: string): SQL =>
  sql`(${channel} = ${audience} or exists (
    select 1 from channels sa join channels sx on sx.id = ${channel}
    where sa.id = ${audience} and sa.visibility = 'org' and sx.org = sa.org and sx.visibility <> 'private'
  ))`

export async function canSee(db: Executor, viewer: Viewer, channel: string): Promise<boolean> {
  const rows = await db.execute<{ seen: boolean }>(sql`select ${seesChannel(sql`${channel}`, viewer)} as seen`)
  return [...rows].some((row) => row.seen === true)
}

export async function channelExists(db: Executor, channel: string): Promise<boolean> {
  const rows = await db.execute<{ found: boolean }>(sql`select exists (select 1 from channels where id = ${channel}) as found`)
  return [...rows].some((row) => row.found === true)
}

export async function requireSees(db: Executor, viewer: Viewer, channel: string | null): Promise<void> {
  if (channel === null) return
  if (await canSee(db, viewer, channel)) return
  if (!(await channelExists(db, channel))) return
  throw forbidden(`${viewer.member} cannot see #${channel}`)
}

export async function isHostMember(db: Executor, viewer: Viewer): Promise<boolean> {
  const rows = await db.execute<{ host: boolean }>(sql`select ${inHostOrg(viewer)} as host`)
  return [...rows].some((row) => row.host === true)
}

export interface Audience {
  audience: string
}

export type Reader = Viewer | Audience

export const readableBy = (channel: AnyColumn | SQL, reader: Reader): SQL => ("audience" in reader ? seenByAll(channel, reader.audience) : visibleTo(channel, reader))

export async function canSeeMember(db: Executor, viewer: Viewer, member: string): Promise<boolean> {
  const rows = await db.execute<{ seen: boolean }>(sql`select ${seesMember(sql`${member}`, viewer)} as seen`)
  return [...rows].some((row) => row.seen === true)
}

export async function stillLive(db: Executor, viewer: Viewer): Promise<boolean> {
  const key = viewer.key === undefined ? sql`true` : sql`exists (select 1 from member_keys k where k.id = ${viewer.key.id} and k.version = ${viewer.key.version} and k.revoked_at is null)`
  const rows = await db.execute<{ live: boolean }>(sql`select (${key} and not exists (select 1 from members m where m.name = ${viewer.member} and m.removed_at is not null)) as live`)
  return [...rows].some((row) => row.live === true)
}
