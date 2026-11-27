import type { ActivityUpdate } from "@flockr/client"
import type { SessionSaving } from "@flockr/contracts/sessions"
import type { Claim } from "../board"
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
  activity: (updates: ActivityUpdate[]) => void
  claim: Claim | null
  saver: SessionSaver | null
}

export interface SessionPlace {
  session: string
  thread: string | null
  claim: Claim | null
}

export interface SessionSaver {
  restore: (place: SessionPlace) => Promise<Uint8Array[]>
  save: (place: SessionPlace, chunk: { data: Uint8Array; cursor: string | null }) => Promise<boolean>
  cursor: (session: string) => string | null
  mark: (session: string, cursor: string) => void
  latest: (thread: string) => Promise<string | null>
}

export interface SessionChunks {
  readonly saving: SessionSaving
  ready: (spec: SessionSpec) => Promise<void>
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
  readonly chunks: SessionChunks | null
  start: (spec: SessionSpec) => Session
}
