export const fenceEnv = "FC_CHANNELS"
export const leaseRenewMs = 5 * 60_000
export const boardRetryMs = 2_000
export const callTimeoutMs = 20_000

export const folderFor = (config: { channels: Readonly<Record<string, string>> }, channel: string): string | null => config.channels[channel] ?? null
