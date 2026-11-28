import type { ChannelReader } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import type { Executor } from "../db/client"
import { messageKey, requireChannel } from "./read"
import { memberSees } from "./visibility"

interface ReaderRow extends Record<string, unknown> {
  member: string
  kind: ChannelReader["kind"]
  org: string
  last_read_id: number | null
  read_at: Date | string | null
  backlog: number
  behind_since: Date | string | null
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString())

export async function listChannelReaders(db: Executor, channel: string): Promise<ChannelReader[]> {
  await requireChannel(db, channel)
  const unread = sql`from messages x
    where x.channel = ${channel} and x.parent_id is null and x.thread_task_id is null and x.who <> m.name
      and x.id > coalesce(r.last_read_id, 0)`
  const rows = await db.execute<ReaderRow>(sql`
    select m.name as member, m.kind, m.org, r.last_read_id, r.read_at,
      (select count(*)::int ${unread}) as backlog,
      (select min(x.created_at) ${unread}) as behind_since
    from members m
    left join reads r on r.member = m.name and r.channel = ${channel}
    where m.removed_at is null and m.kind in ('person', 'agent') and ${memberSees(sql`${channel}`, sql`m.name`)}
    order by backlog desc, m.name`)
  return [...rows].map((row) => ({
    member: row.member,
    kind: row.kind,
    org: row.org,
    lastReadId: row.last_read_id ? messageKey(row.last_read_id) : null,
    readAt: iso(row.read_at),
    backlog: Number(row.backlog),
    behindSince: iso(row.behind_since),
  }))
}
