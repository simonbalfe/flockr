import { describe, expect, test } from "bun:test"
import { Agent, AgentDetail, agentPermissions, DeletedAgent, ErrorBody, EventPage, FeedItem, HeartbeatResult, Machine, Member } from "@flockr/contracts"
import { z } from "zod"
import { createActivityEntry, getActivityEntry } from "../src/board/activity-entries"
import { listAgents } from "../src/board/agents"
import { heartbeat, registerMachine, sweepMachines } from "../src/board/machines"
import { freshBoard } from "./harness"

const harness = { id: "local-agent", label: "Local Agent", capabilities: { resume: true, streaming: true } }
const machineBody = { id: "danas-laptop", name: "danas-laptop", harnesses: [harness] }
const scout = { name: "scout", harness: "local-agent", folder: "/tmp/shop", machine: "danas-laptop" }

async function boardWithMachine() {
  const board = await freshBoard()
  const registered = await board.call("simon", "POST", "/api/machines", machineBody)
  expect(registered.status).toBe(200)
  return board
}

const kindOf = (json: unknown) => ErrorBody.parse(json).kind
const eventsOf = async (call: Awaited<ReturnType<typeof freshBoard>>["call"]) => EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json).events

describe("creating an agent", () => {
  test("a person creates it as a member they own, served by a machine, desired running, with the default permissions", async () => {
    const { call } = await boardWithMachine()
    const created = await call("simon", "POST", "/api/agents", scout)
    expect(created.status).toBe(200)
    const agent = AgentDetail.parse(created.json)
    expect(agent).toMatchObject({ name: "scout", kind: "agent", owner: "simon", runsIn: "Local Agent on danas-laptop", status: "offline" })
    expect(agent.config).toEqual({
      harness: "local-agent",
      harnessLabel: "Local Agent",
      folder: "/tmp/shop",
      machine: "danas-laptop",
      machineName: "danas-laptop",
      permissions: "edit-free-commands-ask",
      personality: null,
      model: null,
      desired: "running",
    })
    const members = z.array(Member).parse((await call("simon", "GET", "/api/members")).json)
    expect(members.map((m) => m.name)).toContain("scout")
    const events = await eventsOf(call)
    expect(events.slice(-2).map((e) => e.type)).toEqual(["member.joined", "agent.created"])
    expect(events.at(-1)).toMatchObject({ actor: "simon", data: { name: "scout", machine: "danas-laptop", desired: "running", harness: "local-agent" } })
  })

  test("names are unique, lowercase, 2 to 32 characters of letters, digits and dashes", async () => {
    const { call } = await boardWithMachine()
    expect((await call("simon", "POST", "/api/agents", scout)).status).toBe(200)
    const again = await call("simon", "POST", "/api/agents", scout)
    expect(again.status).toBe(409)
    expect(kindOf(again.json)).toBe("already_exists")
    const person = await call("simon", "POST", "/api/agents", { ...scout, name: "tim" })
    expect(kindOf(person.json)).toBe("already_exists")
    for (const name of ["s", "Scout", "scout_1", "9lives", "-scout", "a".repeat(33)]) {
      const refused = await call("simon", "POST", "/api/agents", { ...scout, name })
      expect(refused.status).toBe(400)
      expect(kindOf(refused.json)).toBe("invalid")
    }
    expect((await call("simon", "POST", "/api/agents", { ...scout, name: `s${"a".repeat(31)}` })).status).toBe(200)
  })

  test("the folder is absolute, the harness is one the machine reports, the machine exists, and full access is not offered", async () => {
    const { call } = await boardWithMachine()
    expect(kindOf((await call("simon", "POST", "/api/agents", { ...scout, folder: "shop" })).json)).toBe("invalid")
    const harnessMissing = await call("simon", "POST", "/api/agents", { ...scout, harness: "other-agent" })
    expect(harnessMissing.status).toBe(400)
    expect(ErrorBody.parse(harnessMissing.json).error).toContain("offers local-agent")
    const noMachine = await call("simon", "POST", "/api/agents", { ...scout, machine: "nowhere" })
    expect(noMachine.status).toBe(404)
    expect(kindOf((await call("simon", "POST", "/api/agents", { ...scout, permissions: "full-access" })).json)).toBe("invalid")
    expect(agentPermissions).toEqual(["edit-free-commands-ask", "read-only"])
    const readOnly = AgentDetail.parse((await call("simon", "POST", "/api/agents", { ...scout, permissions: "read-only", personality: "You review code." })).json)
    expect(readOnly.config).toMatchObject({ permissions: "read-only", personality: "You review code." })
  })

  test("only a person creates, starts, stops, changes or deletes an agent", async () => {
    const { call } = await boardWithMachine()
    const byAgent = await call("claude", "POST", "/api/agents", scout)
    expect(byAgent.status).toBe(403)
    expect(kindOf(byAgent.json)).toBe("forbidden")
    expect((await call("ghost", "POST", "/api/agents", scout)).status).toBe(403)
    await call("simon", "POST", "/api/agents", scout)
    for (const [method, path, body] of [
      ["POST", "/api/agents/scout/stop", undefined],
      ["POST", "/api/agents/scout/start", undefined],
      ["POST", "/api/agents/scout/pause", undefined],
      ["POST", "/api/agents/scout/resume", undefined],
      ["PATCH", "/api/agents/scout", { folder: "/tmp" }],
      ["DELETE", "/api/agents/scout", undefined],
    ] as const) {
      expect((await call("claude", method, path, body)).status).toBe(403)
    }
  })

  test("an agent that joined by itself and has no machine yet can be given one by its owner", async () => {
    const { call } = await boardWithMachine()
    await call("simon", "POST", "/api/members", { name: "helper", kind: "agent", owner: "simon" })
    const adopted = AgentDetail.parse((await call("simon", "POST", "/api/agents", { ...scout, name: "helper" })).json)
    expect(adopted.config?.machine).toBe("danas-laptop")
    expect(kindOf((await call("simon", "POST", "/api/agents", { ...scout, name: "gemini" })).json)).toBe("already_exists")
  })
})

describe("status", () => {
  test("is derived from the machine's heartbeat, the runner's report and the desired state", async () => {
    const { db, call } = await boardWithMachine()
    await call("simon", "POST", "/api/agents", scout)
    const t0 = new Date()
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000)
    const statusAt = async (now: Date) => {
      const agent = (await listAgents(db, { now })).find((a) => a.name === "scout")
      return { status: agent?.status, reason: agent?.statusReason }
    }
    await registerMachine(db, "simon", machineBody, t0)
    expect(await statusAt(t0)).toEqual({ status: "offline", reason: "Waiting for danas-laptop to start it" })
    await heartbeat(db, "simon", "danas-laptop", { agents: [{ name: "scout", state: "serving", reason: null }] }, at(1))
    expect(await statusAt(at(2))).toEqual({ status: "online", reason: null })
    await heartbeat(db, "simon", "danas-laptop", { agents: [{ name: "scout", state: "working", reason: null }] }, at(16))
    expect(await statusAt(at(17))).toEqual({ status: "working", reason: null })
    await heartbeat(db, "simon", "danas-laptop", { agents: [{ name: "scout", state: "error", reason: "Folder /tmp/shop not found" }] }, at(31))
    expect(await statusAt(at(32))).toEqual({ status: "error", reason: "Folder /tmp/shop not found" })
    expect(await statusAt(at(31 + 44))).toMatchObject({ status: "error" })
    expect(await statusAt(at(31 + 46))).toEqual({ status: "offline", reason: "danas-laptop is offline" })
    expect(await sweepMachines(db, at(31 + 46))).toEqual(["danas-laptop"])
    expect(await sweepMachines(db, at(31 + 47))).toEqual([])
    await heartbeat(db, "simon", "danas-laptop", { agents: [] }, at(80))
    expect(await statusAt(at(81))).toEqual({ status: "offline", reason: "Waiting for danas-laptop to start it" })
    const machines = z.array(Machine).parse((await call("simon", "GET", "/api/machines")).json)
    expect(machines).toEqual([expect.objectContaining({ id: "danas-laptop", harnesses: [harness] })])
  })

  test("a heartbeat changes only its own machine's agents and returns them", async () => {
    const { db, call } = await boardWithMachine()
    await call("simon", "POST", "/api/machines", { ...machineBody, id: "tims-laptop", name: "tims-laptop" })
    await call("simon", "POST", "/api/agents", scout)
    await call("simon", "POST", "/api/agents", { ...scout, name: "other", machine: "tims-laptop" })
    const beat = HeartbeatResult.parse(
      (await call("simon", "POST", "/api/machines/danas-laptop/heartbeat", { agents: [{ name: "scout", state: "serving" }, { name: "other", state: "serving" }] })).json,
    )
    expect(beat.agents.map((a) => a.name)).toEqual(["scout"])
    const all = await listAgents(db)
    expect(all.find((a) => a.name === "scout")?.status).toBe("online")
    expect(all.find((a) => a.name === "other")?.status).toBe("offline")
    expect((await call("simon", "POST", "/api/machines/nowhere/heartbeat", { agents: [] })).status).toBe(404)
  })
})

describe("start, stop, update and delete", () => {
  test("stop and start write one event each and are safe to repeat; stopping shows offline", async () => {
    const { call } = await boardWithMachine()
    await call("simon", "POST", "/api/agents", scout)
    await call("simon", "POST", "/api/machines/danas-laptop/heartbeat", { agents: [{ name: "scout", state: "serving" }] })
    const stopped = AgentDetail.parse((await call("simon", "POST", "/api/agents/scout/stop")).json)
    expect(stopped).toMatchObject({ status: "offline", statusReason: "Stopped", config: { desired: "stopped" } })
    await call("simon", "POST", "/api/agents/scout/stop")
    const started = AgentDetail.parse((await call("simon", "POST", "/api/agents/scout/start")).json)
    expect(started.config?.desired).toBe("running")
    expect(started.status).toBe("offline")
    await call("simon", "POST", "/api/agents/scout/start")
    const types = (await eventsOf(call)).map((e) => e.type).filter((t) => t.startsWith("agent."))
    expect(types).toEqual(["agent.created", "agent.stopped", "agent.started"])
    expect((await call("simon", "POST", "/api/agents/claude/start")).status).toBe(404)
  })

  test("pause and resume write one event each, are safe to repeat, keep the runner's report and refuse a stopped agent", async () => {
    const { call } = await boardWithMachine()
    await call("simon", "POST", "/api/agents", scout)
    await call("simon", "POST", "/api/machines/danas-laptop/heartbeat", { agents: [{ name: "scout", state: "working" }] })
    const paused = AgentDetail.parse((await call("simon", "POST", "/api/agents/scout/pause")).json)
    expect(paused).toMatchObject({ status: "paused", statusReason: "Paused; finishing its current run", config: { desired: "paused" } })
    await call("simon", "POST", "/api/agents/scout/pause")
    await call("simon", "POST", "/api/machines/danas-laptop/heartbeat", { agents: [{ name: "scout", state: "serving" }] })
    const idle = AgentDetail.parse((await call("simon", "GET", "/api/agents/scout")).json)
    expect(idle).toMatchObject({ status: "paused", statusReason: "Paused; new work waits until it is resumed" })
    const resumed = AgentDetail.parse((await call("simon", "POST", "/api/agents/scout/resume")).json)
    expect(resumed).toMatchObject({ status: "online", config: { desired: "running" } })
    await call("simon", "POST", "/api/agents/scout/resume")
    await call("simon", "POST", "/api/agents/scout/stop")
    for (const action of ["pause", "resume"]) {
      const refused = await call("simon", "POST", `/api/agents/scout/${action}`)
      expect(refused.status).toBe(409)
      expect(kindOf(refused.json)).toBe("wrong_state")
    }
    const types = (await eventsOf(call)).map((e) => e.type).filter((t) => t.startsWith("agent."))
    expect(types).toEqual(["agent.created", "agent.paused", "agent.resumed", "agent.stopped"])
  })

  test("update changes folder, permissions and personality and writes one event naming what changed", async () => {
    const { call } = await boardWithMachine()
    await call("simon", "POST", "/api/agents", { ...scout, personality: "Be brief." })
    const updated = AgentDetail.parse((await call("simon", "PATCH", "/api/agents/scout", { folder: "/tmp/other", permissions: "read-only", personality: "" })).json)
    expect(updated.config).toMatchObject({ folder: "/tmp/other", permissions: "read-only", personality: null })
    await call("simon", "PATCH", "/api/agents/scout", { folder: "/tmp/other" })
    const events = (await eventsOf(call)).filter((e) => e.type === "agent.updated")
    expect(events.map((e) => e.data.changed)).toEqual([["folder", "permissions", "personality"]])
    expect((await call("simon", "PATCH", "/api/agents/scout", {})).status).toBe(400)
    expect((await call("simon", "PATCH", "/api/agents/scout", { permissions: "full-access" })).status).toBe(400)
  })

  test("delete stops it and removes the member; its messages keep their author; repeat is safe; the name can be used again", async () => {
    const { call } = await boardWithMachine()
    await call("simon", "POST", "/api/agents", scout)
    await call("scout", "POST", "/api/channels/backend/messages", { text: "Hello from scout." })
    const deleted = DeletedAgent.parse((await call("simon", "DELETE", "/api/agents/scout")).json)
    const again = DeletedAgent.parse((await call("simon", "DELETE", "/api/agents/scout")).json)
    expect(again.removedAt).toBe(deleted.removedAt)
    expect(z.array(Agent).parse((await call("simon", "GET", "/api/agents")).json).map((a) => a.name)).not.toContain("scout")
    expect(z.array(Member).parse((await call("simon", "GET", "/api/members")).json).map((m) => m.name)).not.toContain("scout")
    expect((await call("simon", "GET", "/api/agents/scout")).status).toBe(404)
    expect((await call("scout", "POST", "/api/channels/backend/messages", { text: "still here?" })).status).toBe(403)
    const feed = z.array(FeedItem).parse((await call("simon", "GET", "/api/channels/backend/messages")).json)
    expect(feed.some((item) => item.kind === "text" && item.who === "scout" && item.text === "Hello from scout.")).toBe(true)
    const posted = await call("simon", "POST", "/api/channels/backend/messages", { text: "@scout are you there?" })
    expect(posted.json).toMatchObject({ message: { mentions: [] } })
    const types = (await eventsOf(call)).map((e) => e.type).filter((t) => t.startsWith("agent."))
    expect(types).toEqual(["agent.created", "agent.deleted"])
    const revived = AgentDetail.parse((await call("simon", "POST", "/api/agents", scout)).json)
    expect(revived.config?.desired).toBe("running")
  })
})

describe("runs left behind", () => {
  test("a machine going offline or its runner registering again ends its agents' running runs", async () => {
    const { db, call } = await boardWithMachine()
    await call("simon", "POST", "/api/agents", scout)
    const posted = z.object({ message: z.object({ id: z.string() }).loose() }).parse((await call("simon", "POST", "/api/channels/backend/messages", { text: "@scout look" })).json).message
    const t0 = new Date()
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000)
    await registerMachine(db, "simon", machineBody, t0)
    const first = await createActivityEntry(db, "scout", posted.id, { title: "Looking", parts: [] }, at(1))
    expect(first.entry.status).toBe("running")
    expect(await sweepMachines(db, at(60))).toEqual(["danas-laptop"])
    expect((await getActivityEntry(db, first.entry.id)).status).toBe("stopped")
    const second = await createActivityEntry(db, "scout", posted.id, { title: "Looking again", parts: [] }, at(61))
    await registerMachine(db, "simon", machineBody, at(62))
    expect((await getActivityEntry(db, second.entry.id)).status).toBe("stopped")
  })
})
