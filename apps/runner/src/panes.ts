import type { PanesConfig } from "./config"
import { launcherFor, launcherNames } from "./launcher/registry"
import type { Launcher, PaneResult, RunCommand } from "./launcher/types"

export interface RunPanes {
  forAgent: (name: string) => (run: { thread: string; folder: string }) => void
}

export interface PaneDeps {
  config: PanesConfig | undefined
  path: string
  run: RunCommand
  watch: (agent: string) => readonly string[]
  log: (line: string) => void
  find?: (name: string) => Launcher | null
}

export function createRunPanes(deps: PaneDeps): RunPanes | null {
  const { config, log } = deps
  if (!config) return null
  const launcher = (deps.find ?? launcherFor)(config.launcher)
  if (!launcher) {
    log(`runner: no launcher ${config.launcher} (known: ${launcherNames().join(", ")}); runs show no pane`)
    return null
  }
  const probe = launcher.probe({ PATH: deps.path })
  if (probe.kind === "missing") {
    log(`runner: ${launcher.label} is not available (${probe.reason}); runs show no pane`)
    return null
  }
  const panes = launcher.panes({ space: config.space, run: deps.run })
  const told = new Set<string>()
  const report = (agent: string, result: PaneResult) => {
    switch (result.kind) {
      case "opened":
        log(`${agent}: opened a ${launcher.label} pane (${result.id}) in ${config.space}`)
        return
      case "reused":
        return
      case "failed":
        if (told.has(result.reason)) return
        told.add(result.reason)
        log(`${agent}: no ${launcher.label} pane: ${result.reason}`)
        return
      default: {
        const never: never = result
        throw new Error(`Unknown pane result ${JSON.stringify(never)}`)
      }
    }
  }
  log(`runner: each run shows in a ${launcher.label} pane in ${config.space}`)
  return {
    forAgent: (agent) => (run) =>
      void panes
        .show({ key: agent, folder: run.folder, argv: deps.watch(agent) })
        .then((result) => report(agent, result))
        .catch((error: unknown) => log(`${agent}: no ${launcher.label} pane: ${error instanceof Error ? error.message : String(error)}`)),
  }
}
