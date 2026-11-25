import { sql, type AnyColumn, type SQL } from "drizzle-orm"

export const visibleTo = (channel: AnyColumn | SQL, member: string | null): SQL =>
  sql`not exists (
    select 1 from channels dc
    where dc.id = ${channel} and dc.kind = 'dm'
      and not exists (select 1 from direct_members dm where dm.channel = dc.id and dm.member = ${member})
  )`
