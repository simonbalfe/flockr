import { bridgeEventTypes, type Bridge, type ChatBridgeName } from "@flockr/contracts"
import { and, asc, eq, sql } from "drizzle-orm"
import { bridges, type BridgeSettings, type ChatBridge } from "../chat-bridges"
import type { Database, Executor, Tx } from "../db/client"
import { bridgeChannels, bridgePeople, channels, members, orgs, type MemberRow } from "../db/schema"
import { alreadyExists, forbidden, invalid } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { requireChannel } from "./read"
import { canSee, isHostMember, visibleTo, type Viewer } from "./visibility"

export async function isHostPerson(db: Executor, member: MemberRow): Promise<boolean> {
  if (member.kind !== "person" || member.removedAt !== null) return false
  const [org] = await db.select({ host: orgs.host }).from(orgs).where(eq(orgs.id, member.org))
  return org?.host === true
}

async function requireHostPerson(tx: Tx, bridge: ChatBridge, actor: string): Promise<MemberRow> {
  const member = await requireActor(tx, actor)
  if (!(await isHostPerson(tx, member))) throw forbidden(`${actor} is not a person in the host org; only host-org people link ${bridge.label}`)
  return member
}

export async function linkableChannel(db: Executor, channel: string): Promise<string | null> {
  const [row] = await db.select({ kind: channels.kind, visibility: channels.visibility, host: orgs.host }).from(channels).innerJoin(orgs, eq(orgs.id, channels.org)).where(eq(channels.id, channel))
  if (!row) return `No channel #${channel}`
  if (!row.host) return `#${channel} belongs to another org; only host-org channels sync`
  if (row.kind !== "channel" || row.visibility !== "org") return `#${channel} is ${row.kind === "dm" ? "a direct message" : row.visibility}; only org-wide channels sync, so private and shared ones stay off`
  return null
}

async function present(db: Executor, viewer: Viewer, bridge: ChatBridge, settings: BridgeSettings): Promise<Bridge> {
  const linked = await db
    .select()
    .from(bridgeChannels)
    .where(and(eq(bridgeChannels.bridge, bridge.name), sql`${visibleTo(bridgeChannels.channel, viewer)}`))
    .orderBy(asc(bridgeChannels.channel))
  const host = await isHostMember(db, viewer)
  const people = host ? await db.select().from(bridgePeople).where(eq(bridgePeople.bridge, bridge.name)).orderBy(asc(bridgePeople.member)) : []
  const [mine] = await db.select().from(bridgePeople).where(and(eq(bridgePeople.bridge, bridge.name), eq(bridgePeople.member, viewer.member)))
  return {
    name: bridge.name,
    label: bridge.label,
    enabled: settings[bridge.name] !== undefined,
    channels: linked.map((row) => ({ channel: row.channel, external: row.external, linkedBy: row.linkedBy, linkedAt: row.linkedAt.toISOString() })),
    people: people.map((row) => ({ member: row.member, external: row.external, linkedAt: row.linkedAt.toISOString() })),
    me: mine?.external ?? null,
  }
}

export async function listBridges(db: Executor, viewer: Viewer, settings: BridgeSettings): Promise<Bridge[]> {
  return Promise.all(Object.values(bridges).map((bridge) => present(db, viewer, bridge, settings)))
}

interface LinkRequest {
  bridge: ChatBridgeName
  external: string
}

export async function linkBridgeChannel(db: Database, viewer: Viewer, request: LinkRequest & { channel: string }, settings: BridgeSettings): Promise<Bridge> {
  const bridge = bridges[request.bridge]
  const { channel, external } = request
  if (!bridge.channelId.test(external)) throw invalid(`${external} is not a ${bridge.label} channel id`)
  await mutate(db, async (tx, emit) => {
    await requireHostPerson(tx, bridge, viewer.member)
    await requireChannel(tx, channel)
    if (!(await canSee(tx, viewer, channel))) throw forbidden(`${viewer.member} cannot see #${channel}`)
    const refusal = await linkableChannel(tx, channel)
    if (refusal) throw forbidden(refusal)
    const [taken] = await tx.select().from(bridgeChannels).where(and(eq(bridgeChannels.bridge, bridge.name), eq(bridgeChannels.external, external))).for("update")
    if (taken && taken.channel !== channel) throw alreadyExists(`${bridge.label} channel ${external} is already linked to #${taken.channel}; unlink it there first`)
    if (taken) return
    const [prior] = await tx.select().from(bridgeChannels).where(and(eq(bridgeChannels.bridge, bridge.name), eq(bridgeChannels.channel, channel))).for("update")
    if (prior) await tx.update(bridgeChannels).set({ external, linkedBy: viewer.member, linkedAt: new Date() }).where(and(eq(bridgeChannels.bridge, bridge.name), eq(bridgeChannels.channel, channel)))
    else await tx.insert(bridgeChannels).values({ bridge: bridge.name, channel, external, linkedBy: viewer.member })
    emit({ type: bridgeEventTypes.channelLinked, actor: viewer.member, channel, data: { bridge: bridge.name, external, previous: prior?.external ?? null } })
  })
  return present(db, viewer, bridge, settings)
}

export async function unlinkBridgeChannel(db: Database, viewer: Viewer, request: { bridge: ChatBridgeName; channel: string }, settings: BridgeSettings): Promise<Bridge> {
  const bridge = bridges[request.bridge]
  const { channel } = request
  await mutate(db, async (tx, emit) => {
    await requireHostPerson(tx, bridge, viewer.member)
    await requireChannel(tx, channel)
    if (!(await canSee(tx, viewer, channel))) throw forbidden(`${viewer.member} cannot see #${channel}`)
    const [gone] = await tx.delete(bridgeChannels).where(and(eq(bridgeChannels.bridge, bridge.name), eq(bridgeChannels.channel, channel))).returning()
    if (gone) emit({ type: bridgeEventTypes.channelUnlinked, actor: viewer.member, channel, data: { bridge: bridge.name, external: gone.external } })
  })
  return present(db, viewer, bridge, settings)
}

export async function linkBridgePerson(db: Database, viewer: Viewer, request: LinkRequest, settings: BridgeSettings): Promise<Bridge> {
  const bridge = bridges[request.bridge]
  const { external } = request
  if (!bridge.userId.test(external)) throw invalid(`${external} is not a ${bridge.label} user id`)
  await mutate(db, async (tx, emit) => {
    const member = await requireHostPerson(tx, bridge, viewer.member)
    const [taken] = await tx.select().from(bridgePeople).where(and(eq(bridgePeople.bridge, bridge.name), eq(bridgePeople.external, external))).for("update")
    if (taken && taken.member !== member.name) throw alreadyExists(`${bridge.label} user ${external} is already linked to ${taken.member}`)
    if (taken) return
    const [prior] = await tx.select().from(bridgePeople).where(and(eq(bridgePeople.bridge, bridge.name), eq(bridgePeople.member, member.name))).for("update")
    if (prior) await tx.update(bridgePeople).set({ external, linkedAt: new Date() }).where(and(eq(bridgePeople.bridge, bridge.name), eq(bridgePeople.member, member.name)))
    else await tx.insert(bridgePeople).values({ bridge: bridge.name, member: member.name, external })
    emit({ type: bridgeEventTypes.personLinked, actor: member.name, data: { bridge: bridge.name, member: member.name } })
  })
  return present(db, viewer, bridge, settings)
}

export async function unlinkBridgePerson(db: Database, viewer: Viewer, request: { bridge: ChatBridgeName }, settings: BridgeSettings): Promise<Bridge> {
  const bridge = bridges[request.bridge]
  await mutate(db, async (tx, emit) => {
    const member = await requireActor(tx, viewer.member)
    const [gone] = await tx.delete(bridgePeople).where(and(eq(bridgePeople.bridge, bridge.name), eq(bridgePeople.member, member.name))).returning()
    if (gone) emit({ type: bridgeEventTypes.personUnlinked, actor: member.name, data: { bridge: bridge.name, member: member.name } })
  })
  return present(db, viewer, bridge, settings)
}

export async function linkedPerson(db: Executor, bridge: ChatBridge, external: string): Promise<MemberRow | null> {
  const [row] = await db
    .select({ member: members })
    .from(bridgePeople)
    .innerJoin(members, eq(members.name, bridgePeople.member))
    .where(and(eq(bridgePeople.bridge, bridge.name), eq(bridgePeople.external, external)))
  if (!row || !(await isHostPerson(db, row.member))) return null
  return row.member
}
