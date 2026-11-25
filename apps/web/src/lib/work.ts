import { currentStep } from "@flockr/client"
import type { ActivityEntry, ActivityPart } from "@/api/types"

export type WorkStatus = ActivityEntry["status"]

export interface WorkSummary {
  status: WorkStatus
  headline: string
  detail: string
  steps: number
  failed: number
  durationMs: number
  stopRequested: boolean
}

export type WorkRun<T> = { kind: "work"; id: string; entries: ActivityEntry[] } | { kind: "item"; item: T }

const isActivity = <T extends { kind: string }>(item: T | ActivityEntry): item is ActivityEntry => item.kind === "activity"

export function splitWork<T extends { kind: string }>(items: (T | ActivityEntry)[]): WorkRun<T>[] {
  const runs: WorkRun<T>[] = []
  for (const item of items) {
    if (!isActivity(item)) {
      runs.push({ kind: "item", item })
      continue
    }
    const last = runs[runs.length - 1]
    const sameRun = last?.kind === "work" && (item.runId === null || last.entries.every((e) => e.runId === null || e.runId === item.runId))
    if (last?.kind === "work" && sameRun) last.entries.push(item)
    else runs.push({ kind: "work", id: item.id, entries: [item] })
  }
  return runs
}

const statusRank = { running: 3, error: 2, stopped: 1, ok: 0 } as const satisfies Record<WorkStatus, number>

const partFailed = (part: ActivityPart) => ("status" in part && part.status === "error") || (part.type === "tests" && part.failed > 0) || part.type === "error"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const kindWords = {
  tool: ["tool call", "tool calls"],
  terminal: ["command", "commands"],
  reasoning: ["thought", "thoughts"],
  plan: ["plan", "plans"],
  files: ["file change", "file changes"],
  tests: ["test run", "test runs"],
  subagent: ["subagent", "subagents"],
  error: ["error", "errors"],
} as const satisfies Record<ActivityPart["type"], readonly [string, string]>

export function workCounts(parts: ActivityPart[]): string {
  const counts = new Map<ActivityPart["type"], number>()
  for (const part of parts) counts.set(part.type, (counts.get(part.type) ?? 0) + 1)
  const files = parts.flatMap((p) => (p.type === "files" ? p.files.map((f) => f.path) : []))
  const words: string[] = []
  for (const [type, n] of counts) {
    if (type === "files" || type === "reasoning" || type === "plan") continue
    const [one, many] = kindWords[type]
    words.push(plural(n, one, many))
  }
  if (files.length) words.push(plural(new Set(files).size, "file changed", "files changed"))
  return words.join(" · ")
}

export function summarizeWork(entries: ActivityEntry[], now: number): WorkSummary {
  const parts = entries.flatMap((e) => e.parts)
  const status = entries.reduce<WorkStatus>((worst, e) => (statusRank[e.status] > statusRank[worst] ? e.status : worst), "ok")
  const first = entries[0]
  const last = entries[entries.length - 1]
  const running = [...entries].reverse().find((e) => e.status === "running")
  const start = first ? Date.parse(first.at) : now
  const end = status === "running" ? now : Math.max(...entries.map((e) => Date.parse(e.endedAt ?? e.updatedAt)))
  const failed = parts.filter(partFailed).length
  return {
    status,
    headline: running ? currentStep(running) : (last?.title ?? ""),
    detail: workCounts(parts),
    steps: parts.length,
    failed,
    durationMs: Math.max(0, end - start),
    stopRequested: entries.some((e) => e.status === "running" && e.stopRequestedAt !== null),
  }
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 1) return "<1s"
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

export function partDuration(part: ActivityPart, now: number): number | null {
  if (!("status" in part)) return null
  if (part.durationMs !== null) return part.durationMs
  return part.status === "running" ? Math.max(0, now - Date.parse(part.startedAt)) : null
}

export function latestRunning(entries: ActivityEntry[], member: string): ActivityEntry | undefined {
  return [...entries].reverse().find((e) => e.who === member && e.status === "running")
}
