import type { PermissionRule, ToolRequest } from "../permissions"

export interface HarnessCapabilities {
  resume: boolean
  streaming: boolean
}

export interface PermissionBridge {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface SessionSpec {
  title: string
  prompt: string
  instructions: string
  folder: string
  env: Record<string, string>
  resumeId: string | null
  bridge: PermissionBridge
  timeLimitMs: number
  rule: PermissionRule
  thread: string
  personality: string | null
  model: string | null
}

export type SessionExit = { kind: "finished"; text: string } | { kind: "failed"; error: string } | { kind: "stopped" }

export type SessionStatus = "running" | "exited"

export interface Session {
  readonly id: string
  readonly exit: Promise<SessionExit>
  send: (text: string) => boolean
  stop: () => void
  status: () => SessionStatus
}

export interface PermissionCodec {
  read: (args: unknown) => ToolRequest | null
  allow: (request: ToolRequest) => unknown
  deny: (message: string) => unknown
}

export type HarnessProbe = { kind: "available" } | { kind: "missing"; reason: string }

export interface Harness {
  readonly name: string
  readonly label: string
  readonly capabilities: HarnessCapabilities
  probe: (env: { PATH: string }) => HarnessProbe
  readonly passEnv: readonly string[]
  readonly permissions: PermissionCodec
  start: (spec: SessionSpec) => Session
}
