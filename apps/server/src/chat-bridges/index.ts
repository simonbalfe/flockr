import { chatBridges, type ChatBridgeName } from "@flockr/contracts"
import type { BridgeSettings, ChatBridge } from "./bridge"
import { slack } from "./slack"

export type { BridgeButton, BridgeConnection, BridgeInbound, BridgePost, BridgeSettings, ChatBridge } from "./bridge"

export const bridges = { slack } as const satisfies Record<ChatBridgeName, ChatBridge>

export function bridgeFor(name: string): ChatBridge | null {
  const known = chatBridges.find((bridge) => bridge === name)
  return known ? bridges[known] : null
}

export function bridgeSettingsFrom(env: Record<string, unknown>): BridgeSettings {
  const settings: BridgeSettings = {}
  for (const bridge of Object.values(bridges)) {
    const connection = bridge.connectionFrom(env)
    if (connection) settings[bridge.name] = connection
  }
  return settings
}
