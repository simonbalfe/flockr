import type { ChatBridgeName } from "@flockr/contracts"

export interface BridgeConnection {
  secret: string
  token: string
  fetch: typeof fetch
}

export type BridgeSettings = Partial<Record<ChatBridgeName, BridgeConnection>>

export type BridgeInbound =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; key: string; channel: string; ts: string; thread: string | null; user: string; text: string }
  | { kind: "action"; key: string; channel: string; user: string; value: string; respondTo: string | null }
  | { kind: "ignored"; reason: string }

export interface BridgeButton {
  label: string
  value: string
}

export interface BridgePost {
  channel: string
  thread: string | null
  text: string
  buttons: BridgeButton[]
}

export interface ChatBridge {
  readonly name: ChatBridgeName
  readonly label: string
  readonly memberName: string
  readonly channelId: RegExp
  readonly userId: RegExp
  connectionFrom: (env: Record<string, unknown>) => BridgeConnection | null
  verify: (headers: Headers, body: string, connection: BridgeConnection) => Promise<boolean>
  parse: (headers: Headers, body: string) => BridgeInbound
  post: (connection: BridgeConnection, post: BridgePost) => Promise<{ ts: string }>
  tell: (connection: BridgeConnection, respondTo: string, text: string) => Promise<void>
  unlinkedAuthor: (user: string) => string
}
