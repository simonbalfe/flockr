import { keyEventTypes, keyLimits, mayManageKeys, type CreateKeyBody, type CreatedKey, type MemberKey } from "@flockr/contracts"
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channels, memberKeys, members, type MemberKeyRow, type MemberRow } from "../db/schema"
import { forbidden, invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember } from "./read"
import { canSee, viewerOf } from "./visibility"

const touchEveryMs = 60_000

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
const randomBytes = (count: number) => crypto.getRandomValues(new Uint8Array(count))

export async function hashKey(secret: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))))
}

export interface KeyIdentity {
  id: string
  member: string
  channels: string[] | null
}

const toKey = (row: MemberKeyRow, owner: string | null): MemberKey => ({
  id: row.id,
  member: row.member,
  owner,
  shown: row.shown,
  channels: row.channels,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
})

async function requireKeyManager(db: Executor, actor: string): Promise<MemberRow> {
  const row = await requireActor(db, actor)
  if (!mayManageKeys(row)) throw forbidden(`${actor} is an ${row.kind}; only a person can create, list or revoke keys`)
  return row
}

async function requireChannels(tx: Tx, wanted: string[]): Promise<void> {
  const found = await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, wanted))
  const missing = wanted.filter((id) => !found.some((row) => row.id === id))
  if (missing.length) throw invalid(`No channel ${missing.join(", ")}`)
}

export async function createKey(db: Database, actor: string, body: CreateKeyBody): Promise<CreatedKey> {
  return mutate(db, async (tx, emit) => {
    await requireKeyManager(tx, actor)
    const member = await findMember(tx, body.member)
    if (!member) throw invalid(`${body.member} is not a member of this board`)
    const limit = body.channels === null ? null : [...new Set(body.channels)]
    if (limit) await requireChannels(tx, limit)
    if (limit) for (const channel of limit) if (!(await canSee(tx, viewerOf(member.name), channel))) throw invalid(`${member.name} cannot see #${channel}; add them to it before limiting a key to it`)
    const secret = `${keyLimits.secretPrefix}${base64url(randomBytes(32))}`
    const [row] = await tx
      .insert(memberKeys)
      .values({ id: `k_${hex(randomBytes(6))}`, member: member.name, hash: await hashKey(secret), shown: secret.slice(0, keyLimits.shownChars), channels: limit, createdBy: actor })
      .returning()
    if (!row) throw new Error("Key insert returned nothing")
    emit({ type: keyEventTypes.created, actor, data: { id: row.id, member: row.member, channels: row.channels } })
    return { key: toKey(row, member.owner), secret }
  })
}

export async function listKeys(db: Database, actor: string): Promise<MemberKey[]> {
  await requireKeyManager(db, actor)
  const rows = await db
    .select({ key: memberKeys, owner: members.owner })
    .from(memberKeys)
    .innerJoin(members, eq(members.name, memberKeys.member))
    .orderBy(asc(memberKeys.createdAt), asc(memberKeys.id))
  return rows.map((row) => toKey(row.key, row.owner))
}

export async function revokeKey(db: Database, actor: string, id: string): Promise<MemberKey> {
  return mutate(db, async (tx, emit) => {
    await requireKeyManager(tx, actor)
    const [found] = await tx
      .select({ key: memberKeys, owner: members.owner })
      .from(memberKeys)
      .innerJoin(members, eq(members.name, memberKeys.member))
      .where(eq(memberKeys.id, id))
      .for("update", { of: memberKeys })
    if (!found) throw notFound(`No key ${id}`)
    if (found.key.revokedAt) return toKey(found.key, found.owner)
    const [row] = await tx.update(memberKeys).set({ revokedAt: new Date() }).where(eq(memberKeys.id, id)).returning()
    if (!row) throw new Error("Key update returned nothing")
    emit({ type: keyEventTypes.revoked, actor, data: { id: row.id, member: row.member } })
    return toKey(row, found.owner)
  })
}

export async function findLiveKey(db: Database, secret: string, now = new Date()): Promise<KeyIdentity | null> {
  const [row] = await db
    .select({ id: memberKeys.id, member: memberKeys.member, channels: memberKeys.channels, lastUsedAt: memberKeys.lastUsedAt })
    .from(memberKeys)
    .innerJoin(members, eq(members.name, memberKeys.member))
    .where(and(eq(memberKeys.hash, await hashKey(secret)), isNull(memberKeys.revokedAt), isNull(members.removedAt)))
  if (!row) return null
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > touchEveryMs) {
    await db
      .update(memberKeys)
      .set({ lastUsedAt: now })
      .where(and(eq(memberKeys.id, row.id), or(isNull(memberKeys.lastUsedAt), lt(memberKeys.lastUsedAt, new Date(now.getTime() - touchEveryMs)))))
  }
  return { id: row.id, member: row.member, channels: row.channels }
}
