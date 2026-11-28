import { inviteLimits, signInWording, type CreateInviteBody, type IdentitySource, type Invite, type Member, type UpdateProfileBody } from "@flockr/contracts"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import type { Database, Executor } from "../db/client"
import { invites, memberEmails, members, orgs, type InviteRow } from "../db/schema"
import type { EmailSender } from "../email/sender"
import { forbidden, invalid, notFound } from "./errors"
import { mutate } from "./events"
import { createMember, requireActor } from "./members"
import { findAnyMember, findMember, presentMember } from "./read"

export interface InviteMail {
  email: EmailSender
  baseURL: string
  people: ReadonlyMap<string, string>
}

const stateOf = (row: InviteRow, now: Date): Invite["state"] => (row.acceptedAt ? "accepted" : row.revokedAt ? "revoked" : row.expiresAt <= now ? "expired" : "open")

const present = (row: InviteRow, now = new Date()): Invite => ({
  id: row.id,
  email: row.email,
  name: row.member,
  org: row.org,
  invitedBy: row.invitedBy,
  state: stateOf(row, now),
  expiresAt: row.expiresAt.toISOString(),
  at: row.createdAt.toISOString(),
})

type Inviter = { kind: "host" } | { kind: "owner"; org: string }

async function requireInviter(db: Executor, actor: string, via: IdentitySource): Promise<Inviter> {
  if (via === "key") throw forbidden("A key cannot invite; a signed-in person invites")
  const me = await requireActor(db, actor)
  const [org] = await db.select().from(orgs).where(eq(orgs.id, me.org))
  if (me.kind === "person" && org?.host) return { kind: "host" }
  if (me.kind === "person" && org?.selfInvites && org.owner === actor) return { kind: "owner", org: org.id }
  throw forbidden(`${actor} cannot invite; a person in the org that runs the board invites, or a client org's owner once that org has self-invites on`)
}

const inviterSees = (inviter: Inviter, row: InviteRow) => inviter.kind === "host" || row.org === inviter.org

export async function memberOfEmail(db: Executor, email: string): Promise<string | undefined> {
  const [row] = await db.select({ member: memberEmails.member }).from(memberEmails).where(eq(memberEmails.email, email.trim().toLowerCase()))
  return row?.member
}

export async function openInvite(db: Executor, email: string, now = new Date()): Promise<InviteRow | undefined> {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.email, email.trim().toLowerCase()), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now)))
    .orderBy(desc(invites.id))
    .limit(1)
  return row
}

export async function createInvite(db: Database, mail: InviteMail, who: { actor: string; via: IdentitySource }, body: CreateInviteBody): Promise<Invite> {
  const inviter = await requireInviter(db, who.actor, who.via)
  if (inviter.kind === "owner" && body.org !== inviter.org) throw forbidden(`${who.actor} invites only into ${inviter.org}`)
  const row = await mutate(db, async (tx, emit) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, body.org))
    if (!org) throw invalid(`No org ${body.org}; create it first (flockr orgs create)`)
    if (mail.people.has(body.email) || (await memberOfEmail(tx, body.email))) throw invalid(`${body.email} already signs in to this board`)
    if (await findAnyMember(tx, body.name)) throw invalid(`The name ${body.name} is taken; pick another`)
    if (await openInvite(tx, body.email)) throw invalid(`${body.email} already has an open invite; revoke it to send a new one`)
    const [created] = await tx
      .insert(invites)
      .values({ email: body.email, member: body.name, org: body.org, invitedBy: who.actor, expiresAt: new Date(Date.now() + inviteLimits.days * 86_400_000) })
      .returning()
    if (!created) throw new Error("Invite insert returned nothing")
    emit({ type: "invite.created", actor: who.actor, data: { invite: created.id, org: created.org, name: created.member } })
    return { created, orgName: org.name }
  })
  await mail.email.send({
    to: body.email,
    subject: `${who.actor} invited you to Flockr`,
    text: `${who.actor} invited you to Flockr as ${body.name}, in ${row.orgName}.\n\nOpen ${mail.baseURL}, enter this address and press "${signInWording.button}". The link we send works once. This invite lasts ${inviteLimits.days} days.\n`,
  })
  return present(row.created)
}

export async function listInvites(db: Database, who: { actor: string; via: IdentitySource }): Promise<Invite[]> {
  const inviter = await requireInviter(db, who.actor, who.via)
  const rows = await db
    .select()
    .from(invites)
    .where(inviter.kind === "owner" ? eq(invites.org, inviter.org) : undefined)
    .orderBy(desc(invites.id))
    .limit(100)
  return rows.map((row) => present(row))
}

export async function revokeInvite(db: Database, who: { actor: string; via: IdentitySource }, id: number): Promise<Invite> {
  const inviter = await requireInviter(db, who.actor, who.via)
  return mutate(db, async (tx, emit) => {
    const [row] = await tx.select().from(invites).where(eq(invites.id, id)).for("update")
    if (!row || !inviterSees(inviter, row)) throw notFound(`Invite ${id} does not exist`)
    if (stateOf(row, new Date()) !== "open") return present(row)
    const [revoked] = await tx.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id)).returning()
    if (!revoked) throw new Error("Invite update returned nothing")
    emit({ type: "invite.revoked", actor: who.actor, data: { invite: id } })
    return present(revoked)
  })
}

export async function acceptInvite(db: Database, invite: InviteRow): Promise<string> {
  if (!(await findAnyMember(db, invite.member))) {
    await createMember(db, invite.invitedBy, { name: invite.member, kind: "person", org: invite.org, owner: null, runsIn: null, source: null }, { invited: true })
  }
  await mutate(db, async (tx, emit) => {
    await tx.insert(memberEmails).values({ email: invite.email, member: invite.member }).onConflictDoNothing()
    const [accepted] = await tx.update(invites).set({ acceptedAt: new Date() }).where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt))).returning()
    if (accepted) emit({ type: "invite.accepted", actor: invite.member, data: { invite: invite.id, org: invite.org } })
  })
  return invite.member
}

export async function updateProfile(db: Database, actor: string, name: string, body: UpdateProfileBody): Promise<Member> {
  return mutate(db, async (tx, emit) => {
    const me = await requireActor(tx, actor)
    const target = await findMember(tx, name)
    if (!target) throw notFound(`${name} is not a member of this board`)
    const [org] = await tx.select({ host: orgs.host }).from(orgs).where(eq(orgs.id, me.org))
    const allowed = actor === name || target.owner === actor || (me.kind === "person" && org?.host === true)
    if (!allowed) throw forbidden(`${actor} cannot change ${name}'s profile; the member, its owner or a person in the host org can`)
    const next = {
      displayName: body.displayName === undefined ? target.displayName : body.displayName,
      about: body.about === undefined ? target.about : body.about,
      colour: body.colour === undefined ? target.colour : body.colour,
    }
    if (next.displayName === target.displayName && next.about === target.about && next.colour === target.colour) return presentMember(target)
    const [row] = await tx.update(members).set(next).where(eq(members.name, name)).returning()
    if (!row) throw new Error("Member update returned nothing")
    emit({ type: "member.profile_updated", actor, data: { name, ...next } })
    return presentMember(row)
  })
}
