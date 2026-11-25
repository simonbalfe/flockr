export interface WorkspaceRequest {
  folder: string
  taskId: number
  branch: string
}

export type WorkspaceResult =
  | { kind: "worktree"; folder: string; branch: string; created: boolean }
  | { kind: "plain"; folder: string; reason: string }

export interface CommandOutput {
  code: number
  stdout: string
  stderr: string
}

export type RunIn = (argv: readonly string[]) => Promise<CommandOutput>

export interface Workspace {
  readonly name: string
  readonly label: string
  prepare: (request: WorkspaceRequest) => Promise<WorkspaceResult>
}
