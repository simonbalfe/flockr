import { accessEventTypes, grantsOf, mayManageAgent, type MemberAccess, type SetAccessBody } from "@flockr/contracts"
import { eq } from "drizzle-orm"
import type { Database } from "../db/client"
import { members } from "../db/schema"
import { forbidden, invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"

export async function setAgentAccess(db: Database, actor: string, name: string, body: SetAccessBody): Promise<MemberAccess> {
  if (body.level !== "custom" && body.grants !== undefined) throw invalid(`grants go only with level custom; ${body.level} already says what ${name} may do`)
  if (body.level === "custom" && body.grants === undefined) throw invalid("level custom needs grants: any of reply, work, manage, or [] for reading only")
  return mutate(db, async (tx, emit) => {
    const person = await requireActor(tx, actor)
    if (!mayManageAgent(person)) throw forbidden(`${actor} is an ${person.kind}; only a person can change an agent's access`)
    const [row] = await tx.select().from(members).where(eq(members.name, name)).for("update")
    if (!row || row.removedAt !== null || row.kind !== "agent") throw notFound(`Agent ${name} does not exist; flockr agents lists them`)
    const custom = body.level === "custom" ? grantsOf("custom", body.grants ?? []) : null
    const grants = grantsOf(body.level, custom)
    const unchanged = row.access === body.level && JSON.stringify(grantsOf(row.access, row.accessGrants)) === JSON.stringify(grants)
    if (!unchanged) {
      await tx.update(members).set({ access: body.level, accessGrants: custom }).where(eq(members.name, name))
      emit({ type: accessEventTypes.changed, actor, data: { name, level: body.level, grants } })
    }
    return { name, level: body.level, grants }
  })
}
