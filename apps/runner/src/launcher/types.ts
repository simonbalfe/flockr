export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type RunCommand = (argv: readonly string[]) => Promise<CommandResult>

export interface PaneSpec {
  key: string
  folder: string
  argv: readonly string[]
}

export type PaneResult = { kind: "opened"; id: string } | { kind: "reused"; id: string } | { kind: "failed"; reason: string }

export type LauncherProbe = { kind: "available" } | { kind: "missing"; reason: string }

export interface PaneOptions {
  space: string
  run: RunCommand
}

export interface Panes {
  show: (spec: PaneSpec) => Promise<PaneResult>
}

export interface Launcher {
  readonly name: string
  readonly label: string
  probe: (env: { PATH: string }) => LauncherProbe
  panes: (options: PaneOptions) => Panes
}
