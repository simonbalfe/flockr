import {
  mayChangeChannelMemory,
  mayUseAgentNotes,
  memoryEventTypes,
  memoryItemCap,
  type AddMemoryBody,
  type MemoryItem,
  type MemoryListQuery,
  type MemoryScope,
  type UpdateMemoryBody,
} from "@flockr/contracts"
import { and, desc, eq, isNotNull, isNull, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { memoryItems, type MemoryItemRow } from "../db/schema"
import { forbidden, notFound, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { findMember, requireChannel } from "./read"

// Agent notes (10a) and channel memory (10b): one table, told apart by scope (ADR 0026).
export interface MemorySpace {
  scope: MemoryScope
  owner: string
  fence?: string[] | null
}

export const agentNotes = (agent: string, fence: string[] | null = null): MemorySpace => ({ scope: "agent", owner: agent, fence })
export const channelMemory = (channel: string): MemorySpace => ({ scope: "channel", owner: channel })

const labelOf = (space: MemorySpace) => (space.scope === "agent" ? `${space.owner}'s notes` : `#${space.owner}'s memory`)
const commandOf = (space: MemorySpace) => (space.scope === "agent" ? `flockr notes list --agent ${space.owner}` : `flockr memory list --channel ${space.owner}`)

export function presentMemory(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    owner: row.owner,
    kind: row.kind,
    text: row.text,
    tags: row.tags,
    sourceThread: row.sourceThread,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  }
}

async function openSpace(db: Executor, actor: string, space: MemorySpace) {
  const me = await requireActor(db, actor)
  if (space.scope === "agent") {
    const agent = await findMember(db, space.owner)
    if (!agent || agent.kind !== "agent") throw notFound(`Agent ${space.owner} does not exist; flockr agents lists them`)
    if (!mayUseAgentNotes({ actor: me, agent: space.owner })) throw forbidden(`${actor} is an ${me.kind}; an agent reads and writes only its own notes, and ${space.owner}'s belong to ${space.owner} and people`)
    if (me.org !== agent.org) throw forbidden(`${actor} is in org ${me.org}; ${space.owner}'s notes stay in ${agent.org}`)
  } else {
    await requireChannel(db, space.owner)
  }
  return me
}

const emitMemory = (emit: Emit, type: string, actor: string, row: MemoryItemRow, data: Record<string, unknown> = {}) =>
  emit({
    type,
    actor,
    channel: row.scope === "channel" ? row.owner : null,
    data: { scope: row.scope, owner: row.owner, id: row.id, kind: row.kind, text: row.text, tags: row.tags, sourceThread: row.sourceThread, ...data },
  })

const inSpace = (space: MemorySpace) => and(eq(memoryItems.scope, space.scope), eq(memoryItems.owner, space.owner))

const threadIn = (thread: SQL | AnyColumn, fence: string[]) => {
  const channels = sql.join(fence.map((c) => sql`${c}`), sql`, `)
  return sql`(exists (select 1 from messages fm where 'm' || fm.id = ${thread} and fm.channel in (${channels})) or exists (select 1 from tasks ft where ft.id::text = ${thread} and ft.channel in (${channels})))`
}

const inView = (space: MemorySpace) => {
  const fence = space.fence ?? null
  if (fence === null) return inSpace(space)
  if (!fence.length) return and(inSpace(space), isNull(memoryItems.sourceThread))
  return and(inSpace(space), or(isNull(memoryItems.sourceThread), threadIn(memoryItems.sourceThread, fence)))
}

async function requireThreadInFence(db: Executor, space: MemorySpace, thread: string | null | undefined): Promise<void> {
  const fence = space.fence ?? null
  if (fence === null || thread === null || thread === undefined) return
  const rows = await db.execute<{ inside: boolean }>(sql`select ${fence.length ? threadIn(sql`${thread}`, fence) : sql`false`} as inside`)
  if (![...rows].some((r) => r.inside === true)) throw forbidden(`Thread ${thread} is outside the channels this run may read (${fence.map((c) => `#${c}`).join(", ")})`)
}

async function lockItem(tx: Tx, space: MemorySpace, id: number): Promise<MemoryItemRow> {
  const [row] = await tx.select().from(memoryItems).where(and(inView(space), eq(memoryItems.id, id))).for("update")
  if (!row) throw notFound(`${labelOf(space)} has no item ${id}; ${commandOf(space)} lists them`)
  return row
}

function requireMayChange(me: { name: string; kind: "person" | "agent" | "bridge" | "watcher" }, space: MemorySpace, row: MemoryItemRow): void {
  if (space.scope === "channel" && !mayChangeChannelMemory({ actor: me, createdBy: row.createdBy })) {
    throw forbidden(`${me.name} is an ${me.kind}; an agent changes only the memory it added, and ${row.createdBy} added item ${row.id}. Ask a person to change it`)
  }
}

export async function listMemory(db: Executor, actor: string, space: MemorySpace, query: MemoryListQuery): Promise<MemoryItem[]> {
  await openSpace(db, actor, space)
  const rows = await db
    .select()
    .from(memoryItems)
    .where(and(inView(space), query.state === "active" ? isNull(memoryItems.archivedAt) : isNotNull(memoryItems.archivedAt), query.before === undefined ? undefined : lt(memoryItems.id, query.before)))
    .orderBy(desc(memoryItems.id))
    .limit(query.limit)
  return rows.map(presentMemory)
}

export async function addMemory(db: Database, actor: string, space: MemorySpace, body: AddMemoryBody): Promise<MemoryItem> {
  return mutate(db, async (tx, emit) => {
    await requireThreadInFence(tx, space, body.sourceThread)
    await openSpace(tx, actor, space)
    // One add at a time per owner, so the cap and the key hold under concurrent calls.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`memory:${space.scope}:${space.owner}`}))`)
    if (body.key !== undefined) {
      const [same] = await tx.select().from(memoryItems).where(and(inSpace(space), eq(memoryItems.key, body.key)))
      if (same) return presentMemory(same)
    }
    const [live] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryItems)
      .where(and(inSpace(space), isNull(memoryItems.archivedAt)))
    const cap = memoryItemCap[space.scope]
    if ((live?.count ?? 0) >= cap) throw wrongState(`${labelOf(space)} already hold ${cap} items; archive or edit one first (${commandOf(space)})`)
    const [row] = await tx
      .insert(memoryItems)
      .values({ scope: space.scope, owner: space.owner, kind: body.kind, text: body.text, tags: body.tags, sourceThread: body.sourceThread, key: body.key ?? null, createdBy: actor, updatedBy: actor })
      .returning()
    if (!row) throw new Error("Memory insert returned nothing")
    emitMemory(emit, memoryEventTypes.added, actor, row)
    return presentMemory(row)
  })
}

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((tag, i) => tag === b[i])

export async function updateMemory(db: Database, actor: string, space: MemorySpace, id: number, body: UpdateMemoryBody): Promise<MemoryItem> {
  return mutate(db, async (tx, emit) => {
    const me = await openSpace(tx, actor, space)
    await requireThreadInFence(tx, space, body.sourceThread)
    const current = await lockItem(tx, space, id)
    requireMayChange(me, space, current)
    if (current.archivedAt) throw wrongState(`Item ${id} is archived; restore it before editing`)
    const next = {
      text: body.text ?? current.text,
      kind: body.kind ?? current.kind,
      tags: body.tags ?? current.tags,
      sourceThread: body.sourceThread === undefined ? current.sourceThread : body.sourceThread,
    }
    const changed = [
      ...(next.text !== current.text ? ["text"] : []),
      ...(next.kind !== current.kind ? ["kind"] : []),
      ...(sameTags(next.tags, current.tags) ? [] : ["tags"]),
      ...(next.sourceThread !== current.sourceThread ? ["sourceThread"] : []),
    ]
    if (!changed.length) return presentMemory(current)
    const [row] = await tx
      .update(memoryItems)
      .set({ ...next, updatedBy: actor, updatedAt: new Date() })
      .where(eq(memoryItems.id, id))
      .returning()
    if (!row) throw new Error("Memory update returned nothing")
    emitMemory(emit, memoryEventTypes.updated, actor, row, { changed, was: { text: current.text, kind: current.kind } })
    return presentMemory(row)
  })
}

export async function setMemoryArchived(db: Database, actor: string, space: MemorySpace, id: number, archived: boolean): Promise<MemoryItem> {
  return mutate(db, async (tx, emit) => {
    const me = await openSpace(tx, actor, space)
    const current = await lockItem(tx, space, id)
    requireMayChange(me, space, current)
    if ((current.archivedAt !== null) === archived) return presentMemory(current)
    if (!archived) {
      const [live] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memoryItems)
        .where(and(inSpace(space), isNull(memoryItems.archivedAt)))
      if ((live?.count ?? 0) >= memoryItemCap[space.scope]) throw wrongState(`${labelOf(space)} already hold ${memoryItemCap[space.scope]} items; archive one first`)
    }
    const now = new Date()
    const [row] = await tx
      .update(memoryItems)
      .set({ archivedAt: archived ? now : null, updatedBy: actor, updatedAt: now })
      .where(eq(memoryItems.id, id))
      .returning()
    if (!row) throw new Error("Memory update returned nothing")
    emitMemory(emit, archived ? memoryEventTypes.archived : memoryEventTypes.restored, actor, row)
    return presentMemory(row)
  })
}
