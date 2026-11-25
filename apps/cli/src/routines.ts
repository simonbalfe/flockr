import * as sdk from "@flockr/client"
import { jobStateLabels, routineActionKinds, watchableEventTypes, type Job, type Routine, type RoutineAction, type RoutineTrigger } from "@flockr/client"
import { run } from "./api"
import { int, need, UsageError, type Values } from "./args"
import type { CommandContext } from "./activity"

export const triggerText = (t: RoutineTrigger) => (t.kind === "cron" ? `at "${t.schedule}" UTC` : `on ${t.eventType}`)

export function actionText(a: RoutineAction): string {
  switch (a.kind) {
    case "post":
      return `post "${a.text}"`
    case "task":
      return `create task "${a.title}"${a.assignee ? ` for ${a.assignee}` : ""}`
    case "mention":
      return `mention @${a.agent}: "${a.text}"`
    case "brief":
      return "post the morning brief"
    default: {
      const never: never = a
      return String(never)
    }
  }
}

const causeText = (j: Job) => (j.cause.kind === "cron" ? `scheduled ${j.cause.scheduledFor}` : `event ${j.cause.seq} ${j.cause.type}`)

export const jobLine = (j: Job) =>
  `${`job ${j.id}`.padEnd(9)} ${jobStateLabels[j.state].toLowerCase().padEnd(8)} ${causeText(j)}  attempt ${j.attempts}/${j.maxAttempts}${j.result ? `  ${j.result}` : ""}${j.lastError ? `  error: ${j.lastError}` : ""}`

export const routineLine = (r: Routine) => {
  const last = r.recentJobs[0]
  return `${String(r.id).padStart(3)} ${(r.enabled ? "on" : "off").padEnd(4)} ${r.name}  #${r.channel} ${triggerText(r.trigger)}: ${actionText(r.action)}${last ? `  (last: ${jobStateLabels[last.state].toLowerCase()})` : ""}`
}

export function routineDetail(r: Routine): string {
  return [
    `${r.name} (routine ${r.id})`,
    `  state     ${r.enabled ? "on" : "off"}${r.nextRunAt ? `, next run ${r.nextRunAt}` : ""}`,
    `  channel   #${r.channel}`,
    `  trigger   ${triggerText(r.trigger)}`,
    `  action    ${actionText(r.action)}`,
    `  limit     ${r.perHour} runs an hour`,
    `  created   by ${r.createdBy}`,
    `  runs      ${r.recentJobs.length ? "" : "none yet"}`,
    ...r.recentJobs.map((j) => `    ${jobLine(j)}`),
  ].join("\n")
}

function triggerOf(values: Values): RoutineTrigger | undefined {
  if (values.cron !== undefined && values.event !== undefined) throw new UsageError("Give --cron or --event, not both")
  if (values.cron !== undefined) return { kind: "cron", schedule: values.cron }
  if (values.event === undefined) return undefined
  const eventType = watchableEventTypes.find((t) => t === values.event)
  if (!eventType) throw new UsageError(`--event must be one of ${watchableEventTypes.join(", ")}`)
  return { kind: "event", eventType }
}

function actionOf(values: Values): RoutineAction | undefined {
  if (values.action === undefined) return undefined
  const kind = routineActionKinds.find((k) => k === values.action)
  switch (kind) {
    case "post":
      return { kind, text: need(values.text, "--text") }
    case "task":
      return { kind, title: need(values.title, "--title"), assignee: values.for ?? null }
    case "mention":
      return { kind, agent: need(values.agent, "--agent"), text: need(values.text, "--text") }
    case "brief":
      return { kind }
    case undefined:
      throw new UsageError(`--action must be one of ${routineActionKinds.join(", ")}`)
    default: {
      const never: never = kind
      throw new UsageError(`Unknown action ${String(never)}`)
    }
  }
}

const perHourOf = (values: Values) => (values["per-hour"] === undefined ? undefined : int(values["per-hour"], "--per-hour"))

export async function routinesCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  const id = () => int(positionals[2], "routine id")
  const show = (routine: Routine) => print(routine, () => routineDetail(routine))
  switch (sub) {
    case "list": {
      const list = await run(sdk.listRoutines())
      print(list, () => (list.length ? list.map(routineLine).join("\n") : "No routines yet. fc routines create <name> --channel <c> --cron '0 8 * * 1-5' --action brief makes one."))
      return 0
    }
    case "show":
      show(await run(sdk.getRoutine({ path: { id: id() } })))
      return 0
    case "jobs": {
      const limit = values.limit === undefined ? undefined : int(values.limit, "--limit")
      const list = await run(sdk.listRoutineJobs({ path: { id: id() }, query: { limit } }))
      print(list, () => (list.length ? list.map(jobLine).join("\n") : "No runs yet."))
      return 0
    }
    case "create": {
      const trigger = triggerOf(values)
      const action = actionOf(values)
      if (!trigger) throw new UsageError("Give --cron '<m h dom mon dow>' or --event <type>")
      if (!action) throw new UsageError(`Give --action ${routineActionKinds.join("|")}`)
      const body = { name: positionals.slice(2).join(" ").trim() || need(undefined, "routine name"), channel: need(values.channel, "--channel"), trigger, action, perHour: perHourOf(values) }
      const routine = await run(sdk.createRoutine({ body }))
      print(routine, () => `${routineDetail(routine)}\nIt is off. fc routines on ${routine.id} turns it on.`)
      return 0
    }
    case "update": {
      const body = { name: values.name, channel: values.channel, trigger: triggerOf(values), action: actionOf(values), perHour: perHourOf(values) }
      if (Object.values(body).every((v) => v === undefined)) throw new UsageError("Give --name, --channel, --cron or --event, --action (with its --text, --title, --for or --agent) or --per-hour")
      show(await run(sdk.updateRoutine({ path: { id: id() }, body })))
      return 0
    }
    case "on":
      show(await run(sdk.enableRoutine({ path: { id: id() } })))
      return 0
    case "off":
      show(await run(sdk.disableRoutine({ path: { id: id() } })))
      return 0
    case "delete": {
      const deleted = await run(sdk.deleteRoutine({ path: { id: id() } }))
      print(deleted, () => `Deleted routine ${deleted.id}; its past runs stay`)
      return 0
    }
    default:
      throw new UsageError(`Unknown command fc routines ${sub}`)
  }
}

export async function briefCommand(context: CommandContext): Promise<number> {
  const brief = await run(sdk.getBrief())
  context.print(brief, () => brief.text)
  return 0
}
