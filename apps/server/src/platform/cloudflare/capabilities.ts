import type { SandboxCapabilities } from "@flockr/sandbox/sandbox"

export const cloudflareCapabilities: SandboxCapabilities = { sleepsWhenIdle: true, persistentDisk: false, maxSessionSeconds: 24 * 60 * 60, networkPolicies: ["none", "open"] }
