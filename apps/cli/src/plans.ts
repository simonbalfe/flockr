import * as sdk from "@flockr/client"
import { waitLimits, type Focus, type FocusRun, type Plan, type PlanDetail, type Task } from "@flockr/client"
import type { CommandContext } from "./activity"
import { run } from "./api"
import { int, need, seconds, UsageError } from "./args"
import { clock, taskLine } from "./format"

const progressText = (plan: Plan) => `${plan.progress.done} of ${plan.progress.total} done`

export const planLine = (plan: Plan) =>
  `${String(plan.id).padStart(4)}  #${plan.channel.padEnd(12)} ${plan.title}  (${progressText(plan)}${plan.state === "closed" ? ", closed" : ""}, by ${plan.createdBy})`

function planDetail(plan: PlanDetail): string {
  const { total, ...states } = plan.progress
  const counts = Object.entries(states)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state}`)
    .join(", ")
  const lines = [`Plan ${plan.id}: ${plan.title}`, `  channel   #${plan.channel}`, `  state     ${plan.state}${plan.closedAt ? ` since ${clock(plan.closedAt)}` : ""}`, `  by        ${plan.createdBy}`]
  if (plan.goal) lines.push(`  goal      ${plan.goal}`)
  lines.push(`  progress  ${progressText(plan)}${total && counts ? ` (${counts})` : ""}`)
  lines.push(...(plan.tasks.length ? plan.tasks.map((t) => `  ${taskLine(t)}`) : [`  no tasks yet: flockr tasks create ${plan.channel} <title> --plan ${plan.id}`]))
  return lines.join("\n")
}

const clean = (channel: string) => channel.replace(/^#/, "")

export async function plansCommand({ positionals, values, print }: CommandContext): Promise<number> {
  const sub = positionals[1] ?? "list"
  const id = () => int(positionals[2], "plan id")
  const show = (plan: Plan) => print(plan, () => planLine(plan))
  switch (sub) {
    case "list": {
      const list = await run(sdk.listPlans({ query: { channel: values.channel ? clean(values.channel) : undefined, state: values.closed ? "closed" : "open" } }))
      print(list, () => (list.length ? list.map(planLine).join("\n") : values.closed ? "No closed plans." : "No open plans. flockr plans create <title> --channel <c> makes one."))
      return 0
    }
    case "create": {
      const title = need(positionals.slice(2).join(" ").trim() || undefined, "title")
      show(await run(sdk.createPlan({ body: { channel: clean(need(values.channel, "--channel")), title, goal: values.goal ?? null, key: values.key } })))
      return 0
    }
    case "show": {
      const plan = await run(sdk.getPlan({ path: { id: id() } }))
      print(plan, () => planDetail(plan))
      return 0
    }
    case "edit": {
      const body = { title: values.title, goal: values.goal === undefined ? undefined : values.goal || null }
      if (body.title === undefined && body.goal === undefined) throw new UsageError("Give --title or --goal: flockr plans edit <id> --title <t>")
      show(await run(sdk.updatePlan({ path: { id: id() }, body })))
      return 0
    }
    case "close":
      show(await run(sdk.closePlan({ path: { id: id() } })))
      return 0
    case "reopen":
      show(await run(sdk.reopenPlan({ path: { id: id() } })))
      return 0
    case "wait": {
      const timeout = seconds(values.timeout)
      const result = await run(sdk.waitForPlan({ path: { id: id() }, query: { timeout: timeout === null ? undefined : Math.min(timeout, waitLimits.maxSeconds) } }))
      print(result, () => (result.finished ? `Plan ${result.plan.id} finished: every task is done or canceled.` : `Plan ${result.plan.id} still open: ${result.open.map((n) => `#${n}`).join(", ")}`))
      return result.finished ? 0 : 2
    }
    default:
      throw new UsageError(`Unknown command flockr plans ${sub}`)
  }
}

export function planOf(raw: string | undefined): number | null {
  if (raw === undefined || raw === "none") return null
  return int(raw, "plan id")
}

export async function setTaskPlan(positionals: string[]): Promise<Task> {
  const task = int(positionals[2], "task id")
  return run(sdk.setTaskPlan({ path: { id: task }, body: { plan: planOf(need(positionals[3], "plan id or none")) } }))
}

const runLine = (r: FocusRun) =>
  `  ${r.agent} on ${r.taskId === null ? r.threadId : `#${r.taskId}`} ${r.title} (#${r.channel}), ${r.steps} steps since ${clock(r.startedAt)}${r.recent.length ? `\n${r.recent.map((s) => `      ${clock(s.at)} ${s.text}`).join("\n")}` : ""}`

const section = (title: string, lines: string[]) => [title, ...(lines.length ? lines : ["  none"])]

function focusText(focus: Focus): string {
  const { questions, threadQuestions, reviews, blocked } = focus.needsYou
  const needsYou = [
    ...questions.map((t) => `  question  #${t.id} ${t.holder}: ${t.question?.text} [${t.question?.options.join(" / ")}]`),
    ...threadQuestions.map((q) => `  question  ${q.threadId} ${q.who} in #${q.channel}: ${q.question.text} [${q.question.options.join(" / ")}]`),
    ...reviews.map((t) => `  review    #${t.id} ${t.title} by ${t.holder}`),
    ...blocked.map((t) => `  blocked   #${t.id} ${t.title}${t.reason ? `: ${t.reason}` : ""}`),
  ]
  return [
    ...section("Needs you", needsYou),
    ...section("Plans", focus.plans.map((p) => `  ${planLine(p)}`)),
    ...section("Running", focus.running.map(runLine)),
    ...section("Done today", focus.doneToday.map((t) => `  ${taskLine(t)}`)),
  ].join("\n")
}

export async function focusCommand({ print }: CommandContext): Promise<number> {
  const focus = await run(sdk.getFocus())
  print(focus, () => focusText(focus))
  return 0
}
