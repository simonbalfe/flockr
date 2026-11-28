import type { CreateMemberBody, Member } from "@flockr/contracts"
import type { Database, Executor } from "../db/client"
import { members, orgs, type MemberRow } from "../db/schema"
import { alreadyExists, forbidden, invalid, notMember } from "./errors"
import { mutate } from "./events"
import { findAnyMember, findMember, presentMember } from "./read"
import { eq } from "drizzle-orm"

export async function requireActor(db: Executor, name: string): Promise<MemberRow> {
  const row = await findMember(db, name)
  if (!row) throw notMember(`${name} is not a member of this board. Join first with POST /api/members (flockr join ${name} --owner <person>).`)
  return row
}

async function requireMayAdd(db: Executor, actor: string, org: string): Promise<void> {
  const [target] = await db.select().from(orgs).where(eq(orgs.id, org))
  if (!target) throw invalid(`No org ${org}; create it first with POST /api/orgs (flockr orgs create)`)
  const me = await findMember(db, actor)
  if (!me) return
  const [mine] = await db.select().from(orgs).where(eq(orgs.id, me.org))
  if (!mine?.host) throw forbidden(`${actor} is in a client org; only the org that runs the board adds members`)
}

export async function createMember(db: Database, actor: string, body: CreateMemberBody, options: { invited?: boolean } = {}): Promise<Member> {
  return mutate(db, async (tx, emit) => {
    if (await findAnyMember(tx, body.name)) throw alreadyExists(`Member ${body.name} already exists`)
    if (!options.invited) await requireMayAdd(tx, actor, body.org)
    if (body.owner !== null) {
      const owner = await findMember(tx, body.owner)
      if (!owner || owner.kind !== "person") throw invalid(`Owner ${body.owner} must be a person on this board`)
      if (owner.org !== body.org) throw invalid(`Owner ${body.owner} is in org ${owner.org}; an agent's owner is in the agent's org (${body.org})`)
    }
    const [row] = await tx.insert(members).values(body).returning()
    if (!row) throw new Error("Member insert returned nothing")
    emit({ type: "member.joined", actor, data: { name: row.name, kind: row.kind, org: row.org, owner: row.owner } })
    return presentMember(row)
  })
}
