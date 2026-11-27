import { createHash } from "node:crypto"
import {
  fenceSegment,
  mayReadSessions,
  sessionChunkKey,
  sessionEventTypes,
  sessionLimits,
  type OpenSessionBody,
  type SaveChunkBody,
  type SaveChunkResult,
  type SavedSession,
  type SessionChunk,
  type SessionFence,
  type SessionListQuery,
  type SessionSummary,
  unopenedFence,
} from "@flockr/contracts"
import { and, desc, eq } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { sessionPointers, tasks, type SessionPointerRow, type StoredChunk } from "../db/schema"
import type { ObjectStore } from "../storage/store"
import { alreadyExists, forbidden, invalid, notFound, staleClaim, wrongState } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { findMember } from "./read"

export type SessionStore = ObjectStore | null

const chunkType = "application/octet-stream"

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

function presentChunks(row: SessionPointerRow): SavedSession {
  return {
    agent: row.agent,
    session: row.session,
    thread: row.thread,
    fence: row.fence,
    epoch: row.epoch,
    taskId: row.taskId,
    turns: row.chunks.length,
    bytes: row.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    chunks: row.chunks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function presentSummary(row: SessionPointerRow): SessionSummary {
  const { chunks: _chunks, ...summary } = presentChunks(row)
  return summary
}

function requireStore(store: SessionStore): ObjectStore {
  if (!store) throw wrongState("This board has no object store for saved sessions; set FLOCKR_S3_* (ADR 0032)")
  return store
}

async function openAgent(db: Executor, actor: string, agent: string, access: "read" | "write") {
  const me = await requireActor(db, actor)
  const found = await findMember(db, agent)
  if (!found || found.kind !== "agent") throw notFound(`Agent ${agent} does not exist; flockr agents lists them`)
  if (access === "write" && me.name !== agent) throw forbidden(`Only ${agent} saves its own sessions; ${actor} may not`)
  if (access === "read" && !mayReadSessions({ actor: me, agent })) throw forbidden(`${actor} is an ${me.kind}; an agent reads only its own saved sessions`)
  return me
}

const pointerWhere = (agent: string, session: string) => and(eq(sessionPointers.agent, agent), eq(sessionPointers.session, session))

async function findPointer(db: Executor, agent: string, session: string, lock: boolean): Promise<SessionPointerRow | null> {
  const query = db.select().from(sessionPointers).where(pointerWhere(agent, session))
  const [row] = lock ? await query.for("update") : await query
  return row ?? null
}

const missing = (agent: string, session: string) => notFound(`${agent} has no saved session ${session}; flockr sessions list ${agent} lists them`)

async function requireClaimHeld(db: Executor, agent: string, claim: { task: number; epoch: number }): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, claim.task))
  if (!task) throw notFound(`Task #${claim.task} does not exist`)
  if (task.state !== "claimed" || task.holder !== agent || task.claimEpoch !== claim.epoch) {
    throw staleClaim(`${agent} does not hold #${claim.task} at epoch ${claim.epoch}${task.holder ? `; ${task.holder} holds it at epoch ${task.claimEpoch}` : ""}. Its session saves are refused`)
  }
}

async function requireFence(db: Executor, row: SessionPointerRow, fence: SessionFence): Promise<void> {
  const segment = fenceSegment(fence)
  if (segment !== row.fence) throw staleClaim(`Session ${row.session} of ${row.agent} is fenced by ${row.fence}, not ${segment}; another worker opened it. Open it again to restore`)
  if (fence.kind === "claim") await requireClaimHeld(db, row.agent, fence)
}

type TurnCheck = { kind: "next" } | { kind: "repeat" }

function checkTurn(row: SessionPointerRow, chunk: { turn: number; fence: string; sha256: string }): TurnCheck {
  const next = row.chunks.length + 1
  if (chunk.turn === next) return { kind: "next" }
  if (chunk.turn > next) throw wrongState(`Session ${row.session} of ${row.agent} has ${row.chunks.length} turns; the next is ${next}, not ${chunk.turn}`)
  const saved = row.chunks[chunk.turn - 1]
  if (saved && saved.fence === chunk.fence && saved.sha256 === chunk.sha256) return { kind: "repeat" }
  throw alreadyExists(`Turn ${chunk.turn} of session ${row.session} is already saved with other content; a saved turn never changes`)
}

export async function listSessions(db: Executor, actor: string, agent: string, query: SessionListQuery): Promise<SessionSummary[]> {
  await openAgent(db, actor, agent, "read")
  const rows = await db
    .select()
    .from(sessionPointers)
    .where(and(eq(sessionPointers.agent, agent), query.thread === undefined ? undefined : eq(sessionPointers.thread, query.thread)))
    .orderBy(desc(sessionPointers.updatedAt))
    .limit(query.limit)
  return rows.map(presentSummary)
}

export async function getSession(db: Executor, actor: string, agent: string, session: string): Promise<SavedSession> {
  await openAgent(db, actor, agent, "read")
  const row = await findPointer(db, agent, session, false)
  if (!row) throw missing(agent, session)
  return presentChunks(row)
}

export async function openSession(db: Database, actor: string, agent: string, session: string, body: OpenSessionBody): Promise<SavedSession> {
  return mutate(db, async (tx, emit) => {
    await openAgent(tx, actor, agent, "write")
    if (body.claim) await requireClaimHeld(tx, agent, body.claim)
    const current = await lockOrCreate(tx, agent, session, body.thread)
    const epoch = body.claim ? current.epoch : current.epoch + 1
    const fence = body.claim ? fenceSegment({ kind: "claim", ...body.claim }) : fenceSegment({ kind: "session", epoch })
    const [row] = await tx
      .update(sessionPointers)
      .set({ epoch, fence, taskId: body.claim?.task ?? null, thread: body.thread ?? current.thread, updatedAt: new Date() })
      .where(pointerWhere(agent, session))
      .returning()
    if (!row) throw new Error("Session pointer update returned nothing")
    emit({ type: sessionEventTypes.opened, actor, taskId: row.taskId, threadId: null, data: { agent, session, fence, was: current.fence, turns: row.chunks.length } })
    return presentChunks(row)
  })
}

async function lockOrCreate(tx: Tx, agent: string, session: string, thread: string | null): Promise<SessionPointerRow> {
  await tx.insert(sessionPointers).values({ agent, session, thread, epoch: 0, fence: unopenedFence }).onConflictDoNothing()
  const row = await findPointer(tx, agent, session, true)
  if (!row) throw new Error("Session pointer insert returned nothing")
  return row
}

export async function saveChunk(db: Database, store: SessionStore, options: { actor: string; agent: string; session: string; body: SaveChunkBody }): Promise<SaveChunkResult> {
  const { actor, agent, session, body } = options
  const objects = requireStore(store)
  await openAgent(db, actor, agent, "write")
  const bytes = Uint8Array.from(Buffer.from(body.data, "base64"))
  if (bytes.byteLength > sessionLimits.chunkBytesMax) throw invalid(`A chunk is at most ${sessionLimits.chunkBytesMax} bytes; this one is ${bytes.byteLength}`)
  const chunk = { turn: body.turn, fence: fenceSegment(body.fence), sha256: sha256(bytes) }

  const before = await findPointer(db, agent, session, false)
  if (!before) throw missing(agent, session)
  await requireFence(db, before, body.fence)
  if (checkTurn(before, chunk).kind === "repeat") return { saved: false, session: presentSummary(before) }

  const key = sessionChunkKey({ agent, session, fence: chunk.fence, turn: body.turn })
  if ((await objects.create(key, bytes, chunkType)) === "exists") {
    const stored = await objects.get(key)
    if (!stored || sha256(stored) !== chunk.sha256) throw alreadyExists(`${key} already holds other content; a chunk key is written once`)
  }

  return mutate(db, async (tx, emit) => {
    const row = await findPointer(tx, agent, session, true)
    if (!row) throw missing(agent, session)
    await requireFence(tx, row, body.fence)
    if (checkTurn(row, chunk).kind === "repeat") return { saved: false, session: presentSummary(row) }
    const saved: StoredChunk = { ...chunk, bytes: bytes.byteLength, savedAt: new Date().toISOString() }
    const [updated] = await tx
      .update(sessionPointers)
      .set({ chunks: [...row.chunks, saved], updatedAt: new Date() })
      .where(pointerWhere(agent, session))
      .returning()
    if (!updated) throw new Error("Session pointer update returned nothing")
    emit({ type: sessionEventTypes.saved, actor, taskId: updated.taskId, data: { agent, session, turn: chunk.turn, fence: chunk.fence, bytes: saved.bytes } })
    return { saved: true, session: presentSummary(updated) }
  })
}

export async function readChunk(db: Executor, store: SessionStore, options: { actor: string; agent: string; session: string; turn: number }): Promise<SessionChunk> {
  const { actor, agent, session, turn } = options
  const objects = requireStore(store)
  await openAgent(db, actor, agent, "read")
  const row = await findPointer(db, agent, session, false)
  if (!row) throw missing(agent, session)
  const saved = row.chunks[turn - 1]
  if (!saved) throw notFound(`Session ${session} of ${agent} has ${row.chunks.length} turns, not ${turn}`)
  const key = sessionChunkKey({ agent, session, fence: saved.fence, turn })
  const bytes = await objects.get(key)
  if (!bytes || sha256(bytes) !== saved.sha256) throw wrongState(`${key} is missing or does not match its pointer`)
  return { turn, fence: saved.fence, data: Buffer.from(bytes).toString("base64") }
}
