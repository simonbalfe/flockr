import { keyEventTypes, keyLimits, mayManageKeys, type CreatedKey, type IdentitySource, type KeyKind, type KeyRevokeCause, type MemberKey, type RescopeKeyBody, type RevokedKeys } from "@flockr/contracts"
import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { channels, memberKeys, members, type MemberKeyRow, type MemberRow } from "../db/schema"
import { forbidden, invalid, notFound, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
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
  kind: KeyKind
  channels: string[] | null
  version: number
}

export interface KeyCredential {
  via: IdentitySource
  key: KeyIdentity | null
}

export const personCredential: KeyCredential = { via: "session", key: null }

export interface CreateKeyInput {
  member: string
  channels: string[] | null
  kind?: KeyKind
  client?: { id: string; name: string }
}

interface KeyManager {
  person: MemberRow
  provisioner: KeyIdentity | null
}

const toKey = (row: MemberKeyRow, owner: string | null): MemberKey => ({
  id: row.id,
  member: row.member,
  kind: row.kind,
  owner,
  shown: row.shown,
  channels: row.channels,
  createdBy: row.createdBy,
  madeByKey: row.madeByKey,
  client: row.clientName,
  createdAt: row.createdAt.toISOString(),
  rotatedAt: row.rotatedAt?.toISOString() ?? null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
})

export const keysCannotMintKeys = "A key cannot make, list, rotate or revoke keys; a signed-in person or a provisioning key does"

async function requireKeyManager(db: Executor, actor: string, credential: KeyCredential): Promise<KeyManager> {
  if (credential.via === "key" && credential.key?.kind !== "provisioning") throw forbidden(keysCannotMintKeys)
  const person = await requireActor(db, actor)
  if (!mayManageKeys(person)) throw forbidden(`${actor} is an ${person.kind}; only a person can create, list or revoke keys`)
  return { person, provisioner: credential.via === "key" ? credential.key : null }
}

async function requireChannels(tx: Tx, wanted: string[]): Promise<void> {
  const found = await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, wanted))
  const missing = wanted.filter((id) => !found.some((row) => row.id === id))
  if (missing.length) throw invalid(`No channel ${missing.join(", ")}`)
}

async function channelLimit(tx: Tx, member: MemberRow, wanted: string[] | null, provisioner: KeyIdentity | null): Promise<string[] | null> {
  const limit = wanted === null ? (provisioner?.channels ?? null) : [...new Set(wanted)]
  if (provisioner?.channels && limit) {
    const outside = limit.filter((channel) => !provisioner.channels?.includes(channel))
    if (outside.length) throw forbidden(`This provisioning key is limited to ${provisioner.channels.map((c) => `#${c}`).join(", ")}; it cannot make a key for ${outside.map((c) => `#${c}`).join(", ")}`)
  }
  if (!limit) return null
  await requireChannels(tx, limit)
  for (const channel of limit) if (!(await canSee(tx, viewerOf(member.name), channel))) throw invalid(`${member.name} cannot see #${channel}; add them to it before limiting a key to it`)
  return limit
}

const newSecret = async () => {
  const secret = `${keyLimits.secretPrefix}${base64url(randomBytes(32))}`
  return { secret, hash: await hashKey(secret), shown: secret.slice(0, keyLimits.shownChars) }
}

export async function createKey(db: Database, actor: string, body: CreateKeyInput, credential: KeyCredential = personCredential): Promise<CreatedKey> {
  return mutate(db, async (tx, emit) => {
    const { person, provisioner } = await requireKeyManager(tx, actor, credential)
    const kind = body.kind ?? "member"
    const member = await findMember(tx, body.member)
    if (!member) throw invalid(`${body.member} is not a member of this board`)
    if (provisioner && (kind !== "member" || member.kind !== "agent")) throw forbidden("A provisioning key makes member keys for agents only")
    if (kind === "provisioning" && member.name !== person.name) throw invalid(`A provisioning key acts as the person who makes it; send member ${person.name}`)
    const limit = await channelLimit(tx, member, body.channels, provisioner)
    const made = await newSecret()
    const [row] = await tx
      .insert(memberKeys)
      .values({ id: `k_${hex(randomBytes(6))}`, member: member.name, kind, hash: made.hash, shown: made.shown, channels: limit, createdBy: actor, madeByKey: provisioner?.id ?? null, oauthClient: body.client?.id ?? null, clientName: body.client?.name ?? null })
      .returning()
    if (!row) throw new Error("Key insert returned nothing")
    emit({ type: keyEventTypes.created, actor, data: { id: row.id, member: row.member, kind: row.kind, channels: row.channels, madeByKey: row.madeByKey, client: row.oauthClient } })
    return { key: toKey(row, member.owner), secret: made.secret }
  })
}

export async function listKeys(db: Database, actor: string, credential: KeyCredential = personCredential): Promise<MemberKey[]> {
  const { provisioner } = await requireKeyManager(db, actor, credential)
  const rows = await db
    .select({ key: memberKeys, owner: members.owner })
    .from(memberKeys)
    .innerJoin(members, eq(members.name, memberKeys.member))
    .where(provisioner ? eq(memberKeys.madeByKey, provisioner.id) : undefined)
    .orderBy(asc(memberKeys.createdAt), asc(memberKeys.id))
  return rows.map((row) => toKey(row.key, row.owner))
}

async function lockKey(tx: Tx, id: string, manager: KeyManager): Promise<{ key: MemberKeyRow; owner: string | null; member: MemberRow }> {
  const [found] = await tx
    .select({ key: memberKeys, member: members })
    .from(memberKeys)
    .innerJoin(members, eq(members.name, memberKeys.member))
    .where(eq(memberKeys.id, id))
    .for("update", { of: memberKeys })
  if (!found || (manager.provisioner && found.key.madeByKey !== manager.provisioner.id)) throw notFound(`No key ${id}`)
  return { key: found.key, owner: found.member.owner, member: found.member }
}

export async function revokeKey(db: Database, actor: string, id: string, credential: KeyCredential = personCredential): Promise<MemberKey> {
  return mutate(db, async (tx, emit) => {
    const found = await lockKey(tx, id, await requireKeyManager(tx, actor, credential))
    if (found.key.revokedAt) return toKey(found.key, found.owner)
    const [row] = await tx.update(memberKeys).set({ revokedAt: new Date() }).where(eq(memberKeys.id, id)).returning()
    if (!row) throw new Error("Key update returned nothing")
    emit({ type: keyEventTypes.revoked, actor, data: { id: row.id, member: row.member, cause: "key" satisfies KeyRevokeCause } })
    return toKey(row, found.owner)
  })
}

export async function rotateKey(db: Database, actor: string, id: string, credential: KeyCredential = personCredential): Promise<CreatedKey> {
  return mutate(db, async (tx, emit) => {
    const found = await lockKey(tx, id, await requireKeyManager(tx, actor, credential))
    if (found.key.revokedAt) throw wrongState(`Key ${id} is revoked; make a new key instead (flockr keys create ${found.key.member})`)
    const made = await newSecret()
    const [row] = await tx
      .update(memberKeys)
      .set({ hash: made.hash, shown: made.shown, version: found.key.version + 1, rotatedAt: new Date() })
      .where(eq(memberKeys.id, id))
      .returning()
    if (!row) throw new Error("Key update returned nothing")
    emit({ type: keyEventTypes.rotated, actor, data: { id: row.id, member: row.member } })
    return { key: toKey(row, found.owner), secret: made.secret }
  })
}

export async function rescopeKey(db: Database, actor: string, id: string, body: RescopeKeyBody, credential: KeyCredential = personCredential): Promise<MemberKey> {
  return mutate(db, async (tx, emit) => {
    const manager = await requireKeyManager(tx, actor, credential)
    const found = await lockKey(tx, id, manager)
    if (found.key.revokedAt) throw wrongState(`Key ${id} is revoked; make a new key instead`)
    if (manager.provisioner?.channels && body.channels === null) throw forbidden(`This provisioning key is limited to ${manager.provisioner.channels.map((c) => `#${c}`).join(", ")}; it cannot open a key to every channel`)
    const limit = await channelLimit(tx, found.member, body.channels, manager.provisioner)
    if (JSON.stringify(limit) === JSON.stringify(found.key.channels)) return toKey(found.key, found.owner)
    const [row] = await tx
      .update(memberKeys)
      .set({ channels: limit, version: found.key.version + 1 })
      .where(eq(memberKeys.id, id))
      .returning()
    if (!row) throw new Error("Key update returned nothing")
    emit({ type: keyEventTypes.rescoped, actor, data: { id: row.id, member: row.member, channels: row.channels } })
    return toKey(row, found.owner)
  })
}

export async function revokeKeysOf(tx: Tx, emit: Emit, revoke: { actor: string; member: string; cause: KeyRevokeCause }): Promise<MemberKeyRow[]> {
  const rows = await tx
    .update(memberKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(memberKeys.member, revoke.member), isNull(memberKeys.revokedAt)))
    .returning()
  for (const row of rows) emit({ type: keyEventTypes.revoked, actor: revoke.actor, data: { id: row.id, member: row.member, cause: revoke.cause } })
  return rows
}

export async function revokeMemberKeys(db: Database, actor: string, name: string, credential: KeyCredential = personCredential): Promise<RevokedKeys> {
  return mutate(db, async (tx, emit) => {
    const { provisioner } = await requireKeyManager(tx, actor, credential)
    if (provisioner) throw forbidden("A provisioning key revokes only the keys it made, one at a time; a signed-in person revokes every key of a member")
    const [member] = await tx.select().from(members).where(eq(members.name, name)).for("update")
    if (!member) throw notFound(`No member ${name}`)
    const rows = await revokeKeysOf(tx, emit, { actor, member: name, cause: "all" })
    return { member: name, revoked: rows.map((row) => toKey(row, member.owner)) }
  })
}

export async function findLiveKey(db: Database, secret: string, now = new Date()): Promise<KeyIdentity | null> {
  const [row] = await db
    .select({ id: memberKeys.id, member: memberKeys.member, kind: memberKeys.kind, channels: memberKeys.channels, version: memberKeys.version, lastUsedAt: memberKeys.lastUsedAt })
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
  return { id: row.id, member: row.member, kind: row.kind, channels: row.channels, version: row.version }
}

export async function revokeClientKey(db: Database, secret: string, client: string | null): Promise<void> {
  await mutate(db, async (tx, emit) => {
    const [row] = await tx
      .update(memberKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(memberKeys.hash, await hashKey(secret)), isNull(memberKeys.revokedAt), isNotNull(memberKeys.oauthClient), client === null ? undefined : eq(memberKeys.oauthClient, client)))
      .returning()
    if (row) emit({ type: keyEventTypes.revoked, actor: row.member, data: { id: row.id, member: row.member, cause: "client" satisfies KeyRevokeCause } })
  })
}
