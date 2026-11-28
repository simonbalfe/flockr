import path from "node:path"
import * as sdk from "@flockr/client"
import { accessGrants, accessLevelLabels, accessLevels, agentPermissions, agentStatusLabels, permissionLabels, runnerCommand, type Agent, type AgentDetail, type AgentPermissions, type Machine } from "@flockr/client"
import { run } from "./api"
import { need, UsageError, type Values } from "./args"
import type { CommandContext } from "./activity"
import { activityEntryLine, taskLine } from "./format"
import { watchAgent } from "./watch"

const servedText = (a: Agent) => (a.config ? `${a.config.harnessLabel ?? a.config.harness} on ${a.config.machineName}` : "connects by itself")

export const agentLine = (a: Agent) =>
  `${a.name.padEnd(14)} ${agentStatusLabels[a.status].toLowerCase().padEnd(8)} ${servedText(a)}${a.statusReason && a.status !== "online" ? `  (${a.statusReason})` : ""}${a.owner ? `  via ${a.owner}` : ""}${a.state === "working" ? `  #${a.taskId}` : ""}`

export function agentDetail(a: AgentDetail): string {
  const lines = [`${a.name}`, `  status       ${agentStatusLabels[a.status].toLowerCase()}${a.statusReason ? ` (${a.statusReason})` : ""}`, `  owner        ${a.owner ?? "none"}`, `  access       ${accessLevelLabels[a.access]}${a.access === "custom" ? ` (${a.grants.join(", ") || "reads only"})` : ""}`]
  if (a.config) {
    lines.push(
      `  machine      ${a.config.machineName} (${a.config.machine})`,
      `  harness      ${a.config.harnessLabel ?? "not reported"} (${a.config.harness})`,
      `  folder       ${a.config.folder || "none (board tools only)"}`,
      `  permissions  ${permissionLabels[a.config.permissions].label} (${a.config.permissions})`,
      `  personality  ${a.config.personality ?? "none"}`,
      `  model        ${a.config.model ?? "runner default"}`,
      `  desired      ${a.config.desired}`,
    )
  } else lines.push("  served       connects by itself (no machine)")
  lines.push(`  tasks        ${a.tasks.length ? "" : "none"}`, ...a.tasks.map((t) => `    ${taskLine(t)}`))
  return lines.join("\n")
}

export const machineLine = (m: Machine) =>
  `${m.id.padEnd(22)} ${(m.online ? "online" : "offline").padEnd(8)}${m.hosted ? "hosted  " : ""} ${m.harnesses.length ? m.harnesses.map((h) => `${h.label} (${h.id})`).join(", ") : "no harness"}${m.name === m.id ? "" : `  ${m.name}`}`

function permissionsOf(value: string | undefined): AgentPermissions | undefined {
  if (value === undefined) return undefined
  const found = agentPermissions.find((p) => p === value)
  if (!found) throw new UsageError(`--permissions must be one of ${agentPermissions.join(", ")}`)
  return found
}

const absolute = (folder: string) => path.resolve(folder)

const noRunner = `No runner is connected, so nothing can serve the agent. Start one on the machine that should run it: ${runnerCommand}. Then flockr machines lists it.`

async function pickMachine(values: Values): Promise<Machine> {
  const machines = await run(sdk.listMachines())
  if (values.cloud) {
    const hosted = machines.find((m) => m.hosted)
    if (!hosted) throw new UsageError("This board hosts no cloud agents. flockr machines lists the machines it has.")
    if (!hosted.online) throw new UsageError(`${hosted.name} is offline: this board is not hosting agents right now (it needs a model: FLOCKR_MODEL_BASE_URL)`)
    return hosted
  }
  if (values.machine) {
    const named = machines.find((m) => m.id === values.machine)
    if (!named) throw new UsageError(`No machine ${values.machine}. flockr machines lists them.`)
    return named
  }
  const online = machines.filter((m) => m.online && !m.hosted)
  const [only] = online
  if (!only) throw new UsageError(machines.some((m) => m.hosted && m.online) ? `${noRunner} Or make a cloud agent with --cloud.` : noRunner)
  if (online.length > 1) throw new UsageError(`Several machines are online (${online.map((m) => m.id).join(", ")}); pick one with --machine <id>.`)
  return only
}

function pickHarness(machine: Machine, wanted: string | undefined): string {
  if (wanted) return wanted
  const [only] = machine.harnesses
  if (only && machine.harnesses.length === 1) return only.id
  throw new UsageError(`Give --harness <id>. ${machine.id} offers ${machine.harnesses.length ? machine.harnesses.map((h) => h.id).join(", ") : "none"}.`)
}

export async function agentsCommand(context: CommandContext & { baseUrl: string }): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  const name = () => need(positionals[2], "agent name")
  const show = (agent: AgentDetail) => print(agent, () => agentDetail(agent))
  switch (sub) {
    case "list": {
      const list = await run(sdk.listAgents())
      print(list, () => (list.length ? list.map(agentLine).join("\n") : "No agents yet. flockr agents create <name> --folder <path> makes one."))
      return 0
    }
    case "show":
      show(await run(sdk.getAgent({ path: { name: name() } })))
      return 0
    case "activity": {
      const limit = values.limit === undefined ? undefined : Number(values.limit)
      if (limit !== undefined && !Number.isInteger(limit)) throw new UsageError("--limit must be a whole number")
      const entries = await run(sdk.listAgentActivity({ path: { name: name() }, query: { limit } }))
      print(entries, () => (entries.length ? entries.map((e) => `${activityEntryLine(e)}  in ${e.threadId} (#${e.channel})`).join("\n") : "No runs yet."))
      return 0
    }
    case "create": {
      const agentName = name()
      const machine = await pickMachine(values)
      const body = {
        name: agentName,
        harness: pickHarness(machine, values.harness),
        folder: machine.hosted ? undefined : absolute(need(values.folder, "--folder <path>")),
        machine: machine.id,
        permissions: permissionsOf(values.permissions),
        personality: values.personality ?? null,
        model: values.model ?? null,
      }
      show(await run(sdk.createAgent({ body })))
      return 0
    }
    case "update": {
      const body = {
        folder: values.folder === undefined ? undefined : absolute(values.folder),
        permissions: permissionsOf(values.permissions),
        personality: values.personality,
        model: values.model,
      }
      if (body.folder === undefined && body.permissions === undefined && body.personality === undefined && body.model === undefined)
        throw new UsageError("Give --folder, --permissions, --personality or --model (an empty --personality or --model clears it)")
      show(await run(sdk.updateAgent({ path: { name: name() }, body })))
      return 0
    }
    case "start":
      show(await run(sdk.startAgent({ path: { name: name() } })))
      return 0
    case "stop":
      show(await run(sdk.stopAgent({ path: { name: name() } })))
      return 0
    case "pause":
      show(await run(sdk.pauseAgent({ path: { name: name() } })))
      return 0
    case "resume":
      show(await run(sdk.resumeAgent({ path: { name: name() } })))
      return 0
    case "access": {
      const level = accessLevels.find((l) => l === positionals[3])
      if (!level) throw new UsageError(`Give a level: flockr agents access <name> ${accessLevels.join("|")} [--grants ${accessGrants.join(",")}]`)
      const picked = values.grants === undefined ? undefined : values.grants.split(",").map((g) => g.trim()).filter((g) => g !== "")
      const unknown = picked?.filter((g) => !accessGrants.some((known) => known === g)) ?? []
      if (unknown.length) throw new UsageError(`Unknown grant ${unknown.join(", ")}; grants are ${accessGrants.join(", ")}`)
      const grants = picked?.flatMap((g) => accessGrants.filter((known) => known === g))
      const done = await run(sdk.setAgentAccess({ path: { name: name() }, body: { level, grants } }))
      print(done, () => `${done.name}: ${accessLevelLabels[done.level]}${done.grants.length ? ` (reads, ${done.grants.join(", ")})` : " (reads only)"}`)
      return 0
    }
    case "watch":
      return watchAgent({ baseUrl: context.baseUrl, name: name() })
    case "delete": {
      const deleted = await run(sdk.deleteAgent({ path: { name: name() } }))
      print(deleted, () => `Deleted ${deleted.name}; its messages keep their author`)
      return 0
    }
    default:
      throw new UsageError(`Unknown command flockr agents ${sub}`)
  }
}

export async function machinesCommand(context: CommandContext): Promise<number> {
  const list = await run(sdk.listMachines())
  context.print(list, () => (list.length ? list.map(machineLine).join("\n") : `No machines yet. ${noRunner}`))
  return 0
}
