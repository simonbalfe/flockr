import {
  agentEventTypes,
  type AgentAction,
  type AgentDesired,
  HarnessInfo,
  machineLimits,
  mayManageAgent,
  type ActivityEntry,
  type Agent,
  type AgentConfig,
  type AgentDetail,
  type AgentReport,
  type AgentStatus,
  type CreateAgentBody,
  type DeletedAgent,
  type LiveFrame,
  type Member,
  type UpdateAgentBody,
} from "@flockr/contracts"
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm"
import { z } from "zod"
import type { Database, Executor, Tx } from "../db/client"
import { agents, machines, members, messages, tasks, type AgentRow, type MachineRow, type MemberRow, type TaskRow } from "../db/schema"
import { liveSignals } from "../platform"
import { alreadyExists, forbidden, invalid, notFound, wrongState } from "./errors"
import { mutate, type Emit } from "./events"
import { requireActor } from "./members"
import { activityEntryOf, findAnyMember, presentMember, presentTasks } from "./read"

const Harnesses = z.array(HarnessInfo).catch([])

export const harnessesOf = (row: MachineRow) => Harnesses.parse(row.harnesses)

export const isOnline = (machine: MachineRow, now: Date) => now.getTime() - machine.lastSeenAt.getTime() < machineLimits.onlineSeconds * 1000

const reportStatus = { serving: "online", working: "working", error: "error" } as const satisfies Record<AgentReport, AgentStatus>

export interface StatusOf {
  status: AgentStatus
  reason: string | null
}

export function statusOf(agent: AgentRow, machine: MachineRow | undefined, now: Date): StatusOf {
  if (agent.desired === "stopped") return { status: "offline", reason: "Stopped" }
  if (!machine || !isOnline(machine, now)) return { status: "offline", reason: `${machine?.name ?? agent.machine} is offline` }
  if (agent.desired === "paused") return { status: "paused", reason: agent.reported === "working" ? "Paused; finishing its current run" : "Paused; new work waits until it is resumed" }
  if (agent.reported === null) return { status: "offline", reason: `Waiting for ${machine.name} to start it` }
  const status = reportStatus[agent.reported]
  return { status, reason: status === "error" ? (agent.reportedReason ?? "The runner could not serve it") : null }
}

function configOf(agent: AgentRow, machine: MachineRow | undefined): AgentConfig {
  const harness = machine ? harnessesOf(machine).find((h) => h.id === agent.harness) : undefined
  return {
    harness: agent.harness,
    harnessLabel: harness?.label ?? null,
    folder: agent.folder,
    machine: agent.machine,
    machineName: machine?.name ?? agent.machine,
    permissions: agent.permissions,
    personality: agent.personality,
    model: agent.model,
    desired: agent.desired,
  }
}

interface Served {
  agent: AgentRow
  machine: MachineRow | undefined
}

async function servedBy(db: Executor, names: string[]): Promise<Map<string, Served>> {
  if (!names.length) return new Map()
  const rows = await db.select().from(agents).leftJoin(machines, eq(agents.machine, machines.id)).where(inArray(agents.name, names))
  return new Map(rows.map((row) => [row.agents.name, { agent: row.agents, machine: row.machines ?? undefined }]))
}

function present(member: Member, held: TaskRow[], served: Served | undefined, now: Date): Agent {
  const mine = held.filter((t) => t.holder === member.name).sort((a, b) => a.id - b.id)
  const working = mine.find((t) => t.state === "claimed")
  const blocked = mine.find((t) => t.state === "blocked")
  const work = working
    ? { state: "working" as const, taskId: working.id, leaseExpiresAt: working.leaseExpiresAt?.toISOString() ?? null }
    : blocked
      ? { state: "blocked" as const, taskId: blocked.id, leaseExpiresAt: null }
      : { state: "idle" as const, taskId: null, leaseExpiresAt: null }
  const serving = served ? statusOf(served.agent, served.machine, now) : { status: working ? ("working" as const) : ("offline" as const), reason: null }
  return { ...member, ...work, status: serving.status, statusReason: serving.reason, config: served ? configOf(served.agent, served.machine) : null }
}

export async function listAgents(db: Executor, options: { machine?: string; now?: Date } = {}): Promise<Agent[]> {
  const now = options.now ?? new Date()
  const memberRows = await db
    .select()
    .from(members)
    .where(and(eq(members.kind, "agent"), isNull(members.removedAt)))
    .orderBy(asc(members.createdAt), asc(members.name))
  const served = await servedBy(
    db,
    memberRows.map((m) => m.name),
  )
  const chosen = options.machine === undefined ? memberRows : memberRows.filter((m) => served.get(m.name)?.agent.machine === options.machine)
  const held = await db.select().from(tasks).where(isNotNull(tasks.holder))
  return chosen.map((row) => present(presentMember(row), held, served.get(row.name), now))
}

async function liveAgentMember(db: Executor, name: string): Promise<MemberRow> {
  const row = await findAnyMember(db, name)
  if (!row || row.removedAt !== null || row.kind !== "agent") throw notFound(`Agent ${name} does not exist; flockr agents lists them`)
  return row
}

export async function getAgent(db: Executor, name: string, now = new Date()): Promise<AgentDetail> {
  const row = await liveAgentMember(db, name)
  const rows = await db
    .select()
    .from(tasks)
    .where(or(eq(tasks.holder, name), eq(tasks.assignee, name)))
    .orderBy(asc(tasks.id))
  const served = (await servedBy(db, [name])).get(name)
  return { ...present(presentMember(row), rows, served, now), tasks: await presentTasks(db, rows) }
}

export async function listAgentActivity(db: Executor, name: string, limit: number): Promise<ActivityEntry[]> {
  await liveAgentMember(db, name)
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.kind, "activity"), eq(messages.who, name), isNull(messages.deletedAt)))
    .orderBy(desc(messages.id))
    .limit(limit)
  return rows.flatMap((row) => activityEntryOf(row) ?? [])
}

async function requireManager(tx: Tx, actor: string): Promise<MemberRow> {
  const row = await requireActor(tx, actor)
  if (!mayManageAgent(row)) throw forbidden(`${actor} is an ${row.kind}; only a person can create, start, stop, change or delete an agent`)
  return row
}

async function lockServed(tx: Tx, name: string): Promise<AgentRow> {
  await liveAgentMember(tx, name)
  const [row] = await tx.select().from(agents).where(eq(agents.name, name)).for("update")
  if (!row) throw notFound(`${name} is not served by a machine; it connects by itself. Create a served agent with POST /api/agents`)
  return row
}

async function findMachine(db: Executor, id: string): Promise<MachineRow> {
  const [row] = await db.select().from(machines).where(eq(machines.id, id))
  if (!row) throw notFound(`Machine ${id} is not registered; start a runner on it (bun run runner) and see flockr machines`)
  return row
}

const emitAgent = (emit: Emit, type: string, actor: string, row: AgentRow, data: Record<string, unknown> = {}) =>
  emit({ type, actor, data: { name: row.name, machine: row.machine, desired: row.desired, ...data } })

export async function notifyAgents(tx: Executor, names: string[]): Promise<void> {
  if (!names.length) return
  const frame: LiveFrame = { kind: "agents", names }
  await liveSignals.publish(tx, { kind: "frame", frame })
}

async function claimName(tx: Tx, actor: MemberRow, name: string, values: { runsIn: string; source: string }): Promise<"new" | "existing"> {
  const [inserted] = await tx
    .insert(members)
    .values({ name, kind: "agent", owner: actor.name, ...values })
    .onConflictDoNothing()
    .returning({ name: members.name })
  if (inserted) return "new"
  const [existing] = await tx.select().from(members).where(eq(members.name, name)).for("update")
  if (!existing) throw new Error("Member vanished while creating an agent")
  const [config] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.name, name))
  const revivable = existing.kind === "agent" && (existing.removedAt !== null || (config === undefined && (existing.owner === null || existing.owner === actor.name)))
  if (!revivable) throw alreadyExists(`${name} is already a member; pick another name`)
  await tx
    .update(members)
    .set({ owner: actor.name, removedAt: null, ...values })
    .where(eq(members.name, name))
  return "existing"
}

export async function createAgent(db: Database, actor: string, body: CreateAgentBody): Promise<AgentDetail> {
  await mutate(db, async (tx, emit) => {
    const owner = await requireManager(tx, actor)
    const machine = await findMachine(tx, body.machine)
    const offered = harnessesOf(machine)
    const harness = offered.find((h) => h.id === body.harness)
    if (!harness) {
      throw invalid(`${machine.name} does not offer harness ${body.harness}; it offers ${offered.length ? offered.map((h) => h.id).join(", ") : "none"}. flockr machines lists them`)
    }
    const joined = await claimName(tx, owner, body.name, { runsIn: `${harness.label} on ${machine.name}`, source: harness.id })
    const values = {
      harness: harness.id,
      folder: body.folder,
      machine: machine.id,
      permissions: body.permissions,
      personality: body.personality || null,
      model: body.model || null,
      desired: "running" as const,
      reported: null,
      reportedReason: null,
      reportedAt: null,
      updatedAt: new Date(),
    }
    const [row] = await tx
      .insert(agents)
      .values({ name: body.name, ...values })
      .onConflictDoUpdate({ target: agents.name, set: values })
      .returning()
    if (!row) throw new Error("Agent insert returned nothing")
    if (joined === "new") emit({ type: "member.joined", actor, data: { name: body.name, kind: "agent", owner: owner.name } })
    emitAgent(emit, agentEventTypes.created, actor, row, { harness: row.harness })
  })
  return getAgent(db, body.name)
}

const editableAgentFields = ["folder", "permissions", "personality", "model"] as const

export async function updateAgent(db: Database, actor: string, name: string, body: UpdateAgentBody): Promise<AgentDetail> {
  await mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    const current = await lockServed(tx, name)
    const next = {
      folder: body.folder ?? current.folder,
      permissions: body.permissions ?? current.permissions,
      personality: body.personality === undefined ? current.personality : body.personality || null,
      model: body.model === undefined ? current.model : body.model || null,
    }
    const changed = editableAgentFields.filter((key) => current[key] !== next[key])
    if (!changed.length) return
    const [row] = await tx
      .update(agents)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(agents.name, name))
      .returning()
    if (!row) throw new Error("Agent update returned nothing")
    emitAgent(emit, agentEventTypes.updated, actor, row, { changed })
  })
  return getAgent(db, name)
}

type Transition = { kind: "to"; desired: AgentDesired } | { kind: "same" } | { kind: "refused"; why: string }

const to = (desired: AgentDesired): Transition => ({ kind: "to", desired })
const same: Transition = { kind: "same" }
const refused = (why: string): Transition => ({ kind: "refused", why })

const transitions = {
  start: { running: same, paused: to("running"), stopped: to("running") },
  stop: { running: to("stopped"), paused: to("stopped"), stopped: same },
  pause: { running: to("paused"), paused: same, stopped: refused("is stopped; start it first") },
  resume: { running: same, paused: to("running"), stopped: refused("is stopped, not paused; start it instead") },
} as const satisfies Record<AgentAction, Record<AgentDesired, Transition>>

const actionEvent = {
  start: agentEventTypes.started,
  stop: agentEventTypes.stopped,
  pause: agentEventTypes.paused,
  resume: agentEventTypes.resumed,
} as const satisfies Record<AgentAction, string>

const servesReport = { running: true, paused: true, stopped: false } as const satisfies Record<AgentDesired, boolean>

async function act(db: Database, actor: string, name: string, action: AgentAction): Promise<AgentDetail> {
  await mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    const current = await lockServed(tx, name)
    const transition: Transition = transitions[action][current.desired]
    switch (transition.kind) {
      case "same":
        return
      case "refused":
        throw wrongState(`${name} ${transition.why}`)
      case "to":
        break
      default: {
        const never: never = transition
        throw new Error(`Unknown transition ${JSON.stringify(never)}`)
      }
    }
    const keepReport = servesReport[current.desired] && servesReport[transition.desired]
    const report = keepReport ? {} : { reported: null, reportedReason: null, reportedAt: null }
    const [row] = await tx
      .update(agents)
      .set({ desired: transition.desired, ...report, updatedAt: new Date() })
      .where(eq(agents.name, name))
      .returning()
    if (!row) throw new Error("Agent update returned nothing")
    emitAgent(emit, actionEvent[action], actor, row)
  })
  return getAgent(db, name)
}

export const startAgent = (db: Database, actor: string, name: string) => act(db, actor, name, "start")
export const stopAgent = (db: Database, actor: string, name: string) => act(db, actor, name, "stop")
export const pauseAgent = (db: Database, actor: string, name: string) => act(db, actor, name, "pause")
export const resumeAgent = (db: Database, actor: string, name: string) => act(db, actor, name, "resume")

export async function deleteAgent(db: Database, actor: string, name: string): Promise<DeletedAgent> {
  return mutate(db, async (tx, emit) => {
    await requireManager(tx, actor)
    const [member] = await tx.select().from(members).where(eq(members.name, name)).for("update")
    if (!member || member.kind !== "agent") throw notFound(`Agent ${name} does not exist; flockr agents lists them`)
    if (member.removedAt) return { name, removedAt: member.removedAt.toISOString() }
    const removedAt = new Date()
    await tx.update(members).set({ removedAt }).where(eq(members.name, name))
    const [row] = await tx
      .update(agents)
      .set({ desired: "stopped", reported: null, reportedReason: null, reportedAt: null, updatedAt: removedAt })
      .where(eq(agents.name, name))
      .returning()
    emit({ type: agentEventTypes.deleted, actor, data: { name, machine: row?.machine ?? null } })
    return { name, removedAt: removedAt.toISOString() }
  })
}
