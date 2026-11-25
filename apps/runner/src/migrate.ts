import { copyFileSync, existsSync, renameSync, writeFileSync } from "node:fs"
import { defaultMember } from "@flockr/client"
import type { MachinePort } from "./board"
import type { LegacyAgent, RunnerConfig } from "./config"
import type { Harness } from "./harness/types"
import { keySessions, type JsonStore, type SessionMap } from "./store"

export function withoutLegacy(config: RunnerConfig): Omit<RunnerConfig, "member" | "harness"> {
  const { member: _member, harness: _harness, ...rest } = config
  return rest
}

export const backupFile = (file: string) => `${file}.before-agents`

export function rewriteConfig(file: string, config: RunnerConfig): void {
  if (existsSync(file) && !existsSync(backupFile(file))) copyFileSync(file, backupFile(file))
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(withoutLegacy(config), null, 2)}\n`)
  renameSync(temp, file)
}

export interface Migration {
  file: string
  config: RunnerConfig
  legacy: LegacyAgent
  machine: { id: string; name: string }
  available: readonly Harness[]
  port: MachinePort
  sessions: JsonStore<SessionMap>
  log: (line: string) => void
}

export async function migrateLegacy(m: Migration): Promise<boolean> {
  const { legacy, log } = m
  const harness = m.available.find((h) => h.name === legacy.harness)
  if (!harness) {
    log(`runner: ${m.file} names ${legacy.member} with harness ${legacy.harness}, which this machine cannot run; the file is left as it is`)
    return false
  }
  const existing = await m.port.agent(legacy.member)
  if (!existing?.config) {
    const folder = m.config.channels.general ?? Object.values(m.config.channels)[0]
    if (!folder) {
      log(`runner: ${m.file} names ${legacy.member} but no channel folder; create it with flockr agents create; the file is left as it is`)
      return false
    }
    await m.port.createAgent(existing?.owner ?? defaultMember, { name: legacy.member, harness: harness.name, folder, machine: m.machine.id })
    log(`runner: ${legacy.member} is now an agent served by ${m.machine.name} in ${folder}`)
  }
  m.sessions.set(keySessions(m.sessions.get(), legacy.member))
  rewriteConfig(m.file, m.config)
  log(`runner: moved ${legacy.member} out of ${m.file} (the old file is kept as ${backupFile(m.file)})`)
  return true
}
