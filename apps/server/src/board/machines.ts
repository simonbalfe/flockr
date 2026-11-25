import { machineLimits, type HeartbeatBody, type HeartbeatResult, type Machine, type RegisterMachineBody } from "@flockr/contracts"
import { and, asc, eq, lt } from "drizzle-orm"
import type { Database, Executor, Tx } from "../db/client"
import { agents, machines, type MachineRow } from "../db/schema"
import { endRunsOf } from "./activity-entries"
import { harnessesOf, isOnline, listAgents, notifyAgents, statusOf } from "./agents"
import { notFound } from "./errors"
import { requireActor } from "./members"

function present(row: MachineRow, now: Date): Machine {
  return { id: row.id, name: row.name, harnesses: harnessesOf(row), online: isOnline(row, now), lastSeenAt: row.lastSeenAt.toISOString() }
}

export async function listMachines(db: Executor, now = new Date()): Promise<Machine[]> {
  const rows = await db.select().from(machines).orderBy(asc(machines.createdAt), asc(machines.id))
  return rows.map((row) => present(row, now))
}

async function statusesOn(tx: Tx, id: string, now: Date): Promise<Map<string, string>> {
  const [machine] = await tx.select().from(machines).where(eq(machines.id, id))
  const rows = await tx.select().from(agents).where(eq(agents.machine, id))
  return new Map(
    rows.map((agent) => {
      const { status, reason } = statusOf(agent, machine, now)
      return [agent.name, `${status}:${reason ?? ""}`]
    }),
  )
}

async function changedOn(tx: Tx, id: string, before: Map<string, string>, now: Date): Promise<string[]> {
  const after = await statusesOn(tx, id, now)
  return [...after].filter(([name, status]) => before.get(name) !== status).map(([name]) => name)
}

async function agentsOn(db: Executor, id: string): Promise<string[]> {
  const rows = await db.select({ name: agents.name }).from(agents).where(eq(agents.machine, id))
  return rows.map((r) => r.name)
}

export async function registerMachine(db: Database, actor: string, body: RegisterMachineBody, now = new Date()): Promise<Machine> {
  const machine = await db.transaction(async (tx) => {
    await requireActor(tx, actor)
    const before = await statusesOn(tx, body.id, now)
    const values = { name: body.name, harnesses: body.harnesses, lastSeenAt: now, announcedOnline: true }
    const [row] = await tx
      .insert(machines)
      .values({ id: body.id, ...values })
      .onConflictDoUpdate({ target: machines.id, set: values })
      .returning()
    if (!row) throw new Error("Machine upsert returned nothing")
    await notifyAgents(tx, await changedOn(tx, body.id, before, now))
    return present(row, now)
  })
  await endRunsOf(db, await agentsOn(db, body.id), now)
  return machine
}

export async function heartbeat(db: Database, actor: string, id: string, body: HeartbeatBody, now = new Date()): Promise<HeartbeatResult> {
  const machine = await db.transaction(async (tx) => {
    await requireActor(tx, actor)
    const [current] = await tx.select().from(machines).where(eq(machines.id, id)).for("update")
    if (!current) throw notFound(`Machine ${id} is not registered; register it first with POST /api/machines`)
    const before = await statusesOn(tx, id, now)
    const [row] = await tx
      .update(machines)
      .set({ lastSeenAt: now, announcedOnline: true, ...(body.harnesses ? { harnesses: body.harnesses } : {}) })
      .where(eq(machines.id, id))
      .returning()
    if (!row) throw new Error("Machine update returned nothing")
    const reports = new Map(body.agents.map((entry) => [entry.name, entry]))
    for (const agent of await tx.select().from(agents).where(eq(agents.machine, id))) {
      const report = reports.get(agent.name)
      const reported = report?.state ?? null
      const reportedReason = report?.reason ?? null
      if (agent.reported === reported && agent.reportedReason === reportedReason) continue
      await tx
        .update(agents)
        .set({ reported, reportedReason, reportedAt: report ? now : null })
        .where(eq(agents.name, agent.name))
    }
    await notifyAgents(tx, await changedOn(tx, id, before, now))
    return row
  })
  return { machine: present(machine, now), agents: await listAgents(db, { machine: id, now }) }
}

export async function sweepMachines(db: Database, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - machineLimits.onlineSeconds * 1000)
  const swept = await db.transaction(async (tx) => {
    const gone = await tx
      .update(machines)
      .set({ announcedOnline: false })
      .where(and(eq(machines.announcedOnline, true), lt(machines.lastSeenAt, cutoff)))
      .returning({ id: machines.id })
    const names: string[] = []
    for (const machine of gone) {
      const rows = await tx.select({ name: agents.name }).from(agents).where(eq(agents.machine, machine.id))
      names.push(...rows.map((r) => r.name))
    }
    await notifyAgents(tx, names)
    return { machines: gone.map((m) => m.id), names }
  })
  await endRunsOf(db, swept.names, now)
  return swept.machines
}
