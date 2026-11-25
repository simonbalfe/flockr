import { leaseMinutes } from "@flockr/client"
import { lowLeaseMinutes } from "@/api/session"
import type { Task, TaskState } from "@/api/types"

export const taskStates: TaskState[] = ["waiting", "ready", "claimed", "blocked", "review", "done"]

export const stateLabel: Record<TaskState, string> = {
  waiting: "Waiting",
  ready: "Ready",
  claimed: "Claimed",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
}

export type StatusTone = "normal" | "low" | "you"

export interface TaskStatus {
  text: string
  tone: StatusTone
}

export function leaseLeft(leaseExpiresAt: string | null, now: number): number {
  if (leaseExpiresAt === null) return 0
  return Math.min(leaseMinutes, Math.max(0, Math.ceil((Date.parse(leaseExpiresAt) - now) / 60_000)))
}

export function isLowLease(leaseExpiresAt: string | null, now: number): boolean {
  return leaseLeft(leaseExpiresAt, now) <= lowLeaseMinutes
}

export function taskStatus(task: Task, now: number): TaskStatus {
  switch (task.state) {
    case "waiting":
      return { text: `Waits on ${task.needs.map((n) => `#${n}`).join(", ")}`, tone: "normal" }
    case "ready":
      return { text: task.assignee ? `Ready for ${task.assignee}` : "Ready", tone: "normal" }
    case "claimed":
      if (task.question) return { text: "Asking you", tone: "you" }
      return {
        text: `${task.holder ?? "unclaimed"} · ${leaseLeft(task.leaseExpiresAt, now)} min`,
        tone: isLowLease(task.leaseExpiresAt, now) ? "low" : "normal",
      }
    default:
      return { text: stateLabel[task.state], tone: "normal" }
  }
}

export function toneClass(tone: StatusTone): string {
  if (tone === "low") return "text-destructive"
  if (tone === "you") return "font-medium text-foreground"
  return "text-muted-foreground"
}
