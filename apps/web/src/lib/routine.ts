import { jobStateLabels } from "@flockr/client"
import type { Job, RoutineAction, RoutineTrigger } from "@/api/types"

export function triggerText(trigger: RoutineTrigger): string {
  return trigger.kind === "cron" ? `${trigger.schedule} UTC` : `On ${trigger.eventType}`
}

export function actionText(action: RoutineAction): string {
  switch (action.kind) {
    case "post":
      return `Post "${action.text}"`
    case "task":
      return `Create "${action.title}"${action.assignee ? ` for ${action.assignee}` : ""}`
    case "mention":
      return `@${action.agent} ${action.text}`
    case "brief":
      return "Post the morning brief"
    default: {
      const never: never = action
      return String(never)
    }
  }
}

function span(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} days`
}

export function relative(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now
  if (Math.abs(ms) < 60_000) return ms > 0 ? "in a minute" : "just now"
  return ms > 0 ? `in ${span(ms)}` : `${span(-ms)} ago`
}

export function jobText(job: Job): string {
  const detail = job.state === "failed" || job.state === "queued" ? (job.lastError ?? job.result) : job.result
  return detail ? `${jobStateLabels[job.state]}: ${detail}` : jobStateLabels[job.state]
}
