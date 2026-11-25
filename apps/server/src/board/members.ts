import type { CreateMemberBody, Member } from "@flockr/contracts"
import type { Database, Executor } from "../db/client"
import { members, type MemberRow } from "../db/schema"
import { alreadyExists, invalid, notMember } from "./errors"
import { mutate } from "./events"
import { findAnyMember, findMember } from "./read"

export async function requireActor(db: Executor, name: string): Promise<MemberRow> {
  const row = await findMember(db, name)
  if (!row) throw notMember(`${name} is not a member of this board. Join first with POST /api/members (fc join ${name} --owner <person>).`)
  return row
}

export async function createMember(db: Database, actor: string, body: CreateMemberBody): Promise<Member> {
  return mutate(db, async (tx, emit) => {
    if (await findAnyMember(tx, body.name)) throw alreadyExists(`Member ${body.name} already exists`)
    if (body.owner !== null) {
      const owner = await findMember(tx, body.owner)
      if (!owner || owner.kind !== "person") throw invalid(`Owner ${body.owner} must be a person on this board`)
    }
    const [row] = await tx.insert(members).values(body).returning()
    if (!row) throw new Error("Member insert returned nothing")
    emit({ type: "member.joined", actor, data: { name: row.name, kind: row.kind, owner: row.owner } })
    return { name: row.name, kind: row.kind, owner: row.owner, runsIn: row.runsIn, source: row.source }
  })
}
