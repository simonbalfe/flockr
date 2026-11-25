import { herdr } from "./herdr"
import type { Launcher } from "./types"

export const launchers: readonly Launcher[] = [herdr]

export const launcherFor = (name: string): Launcher | null => launchers.find((l) => l.name === name) ?? null

export const launcherNames = (): string[] => launchers.map((l) => l.name)
