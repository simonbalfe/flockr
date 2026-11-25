import * as sdk from "@flockr/client"
import { ActivityPartInputSchema, ActivityUpdateSchema, ApprovalActionSchema } from "@flockr/client/activity"
import { filesFromDiff, framesFromStack, planStepStatuses, runStatuses, stepStatuses, type ActivityPartInput, type ActivityUpdate } from "@flockr/client"
import { run } from "./api"
import { int, need, optionalInt, UsageError, type Values } from "./args"
import { activityDetail, activityEntryLine } from "./format"

export interface CommandContext {
  positionals: string[]
  values: Values
  print: (data: unknown, text: () => string) => void
}

export const activityWords = ["post", "update", "show", "tool", "exec", "think", "append", "end", "plan", "files", "tests", "error", "finish"] as const
type ActivityWord = (typeof activityWords)[number]

export const isActivityWord = (word: string | undefined): word is ActivityWord => activityWords.some((w) => w === word)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function json(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new UsageError(`${what} must be JSON, got ${raw.slice(0, 60)}`)
  }
}

async function readSource(source: string): Promise<string> {
  return source === "-" ? Bun.stdin.text() : Bun.file(source).text()
}

const pick = <T extends string>(list: readonly T[], value: string | undefined, fallback: T, what: string): T => {
  if (value === undefined) return fallback
  const found = list.find((s) => s === value)
  if (!found) throw new UsageError(`${what} must be one of ${list.join(", ")}`)
  return found
}

const freshId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`

function stepFrom(raw: string) {
  const match = /^\[( |x|>)\]\s*(.+)$/.exec(raw.trim())
  const mark = match?.[1]
  const status = mark === "x" ? planStepStatuses[2] : mark === ">" ? planStepStatuses[1] : planStepStatuses[0]
  return { text: match?.[2] ?? raw.trim(), status }
}

function failureFrom(raw: string) {
  const at = raw.indexOf(": ")
  return at === -1 ? { name: raw, message: "" } : { name: raw.slice(0, at), message: raw.slice(at + 2) }
}

const restText = (ctx: CommandContext, from: number, what: string) => need(ctx.positionals.slice(from).join(" ").trim() || undefined, what)

function entryId(ctx: CommandContext): string {
  return need(ctx.positionals[2], "entry id").replace(/^#/, "")
}

async function send(ctx: CommandContext, updates: ActivityUpdate[]): Promise<number> {
  const id = entryId(ctx)
  const revision = optionalInt(ctx.values.revision, "--revision")
  const result = await run(sdk.updateActivityEntry({ path: { id }, body: { updates, revision } }))
  ctx.print(result, () => `${result.applied ? "Updated" : "Already applied:"} ${activityEntryLine(result.entry)}`)
  return 0
}

const setPart = (part: ActivityPartInput): ActivityUpdate => ({ type: "part.set", part })

async function exec(ctx: CommandContext): Promise<number> {
  const id = entryId(ctx)
  const argv = ctx.positionals.slice(3)
  if (!argv.length) throw new UsageError("Give the command after --: flockr activity exec m41 -- bun test")
  const partId = ctx.values.id ?? freshId("c")
  const command = argv.join(" ")
  const update = (updates: ActivityUpdate[]) => run(sdk.updateActivityEntry({ path: { id }, body: { updates } }))
  await update([setPart({ type: "terminal", id: partId, command, cwd: process.cwd() })])
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  let pending = ""
  let flushing: Promise<unknown> = Promise.resolve()
  const flush = () => {
    if (!pending) return flushing
    const text = pending
    pending = ""
    flushing = flushing.then(() => update([{ type: "part.append", partId, text }]))
    return flushing
  }
  const timer = setInterval(() => void flush().catch((error: unknown) => console.error(error)), 500)
  const pump = async (stream: ReadableStream<Uint8Array>, echo: (text: string) => void) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true })
      pending += text
      echo(text)
    }
  }
  await Promise.all([pump(child.stdout, (t) => process.stdout.write(t)), pump(child.stderr, (t) => process.stderr.write(t))])
  const exitCode = await child.exited
  clearInterval(timer)
  await flush()
  await update([{ type: "part.finished", partId, status: exitCode === 0 ? "ok" : "error", exitCode }])
  return exitCode
}

export async function activityCommand(ctx: CommandContext): Promise<number> {
  const word = ctx.positionals[1]
  if (!isActivityWord(word)) throw new UsageError(`Unknown command flockr activity ${word ?? ""}`)
  const v = ctx.values
  switch (word) {
    case "post": {
      const thread = need(ctx.positionals[2], "thread or task id").replace(/^#/, "")
      const parts = (v.part ?? []).map((raw) => partInput(json(raw, "--part")))
      const body = { title: restText(ctx, 3, "title"), runId: v.run, key: v.key, parts }
      const result = await run(sdk.createActivityEntry({ path: { id: thread }, body }))
      ctx.print(result, () => `${result.applied ? "Posted" : "Already posted:"} ${activityEntryLine(result.entry)}`)
      return 0
    }
    case "update": {
      const raw = v.update ?? []
      if (!raw.length) throw new UsageError("Give at least one --update '<json>'")
      return send(ctx, raw.map((r) => updateInput(json(r, "--update"))))
    }
    case "show": {
      const entry = await run(sdk.getActivityEntry({ path: { id: entryId(ctx) } }))
      ctx.print(entry, () => activityDetail(entry))
      return 0
    }
    case "tool": {
      const input = v.input ? json(v.input, "--input") : {}
      const status = pick(stepStatuses, v.status, v.output === undefined ? "running" : "ok", "--status")
      const part: ActivityPartInput = {
        type: "tool",
        id: v.id ?? freshId("t"),
        name: restText(ctx, 3, "tool name"),
        input: isRecord(input) ? input : { value: input },
        output: v.output,
        status,
        durationMs: optionalInt(v.duration, "--duration"),
      }
      return send(ctx, [setPart(part)])
    }
    case "exec":
      return exec(ctx)
    case "think":
      return send(ctx, [setPart({ type: "reasoning", id: v.id ?? freshId("r"), text: restText(ctx, 3, "text"), status: pick(stepStatuses, v.status, "ok", "--status") })])
    case "append":
      return send(ctx, [{ type: "part.append", partId: need(ctx.positionals[3], "part id"), text: restText(ctx, 4, "text") }])
    case "end": {
      const status = pick(["ok", "error"], v.status, "ok", "--status")
      return send(ctx, [{ type: "part.finished", partId: need(ctx.positionals[3], "part id"), status, exitCode: optionalInt(v.exit, "--exit"), output: v.output }])
    }
    case "plan": {
      const steps = (v.step ?? []).map(stepFrom)
      if (!steps.length) throw new UsageError('Give --step "[x] done step", --step "[>] current step", --step "next step"')
      return send(ctx, [setPart({ type: "plan", id: v.id ?? "plan", title: v.title ?? null, steps })])
    }
    case "files": {
      const files = filesFromDiff(await readSource(need(v.diff, "--diff <file or ->")))
      if (!files.length) throw new UsageError("The diff names no files; pass a unified diff such as git diff output")
      return send(ctx, [setPart({ type: "files", id: v.id ?? freshId("f"), files })])
    }
    case "tests": {
      const failures = (v.failure ?? []).map(failureFrom)
      const part: ActivityPartInput = {
        type: "tests",
        id: v.id ?? freshId("x"),
        command: v.command ?? null,
        passed: int(v.passed, "--passed"),
        failed: optionalInt(v.failed, "--failed") ?? failures.length,
        skipped: optionalInt(v.skipped, "--skipped") ?? 0,
        failures,
        status: pick(stepStatuses, v.status, (optionalInt(v.failed, "--failed") ?? failures.length) > 0 ? "error" : "ok", "--status"),
        durationMs: optionalInt(v.duration, "--duration"),
      }
      return send(ctx, [setPart(part)])
    }
    case "error": {
      const frames = v.stack ? framesFromStack(await readSource(v.stack)) : []
      return send(ctx, [setPart({ type: "error", id: v.id ?? freshId("e"), name: v.title ?? null, message: restText(ctx, 3, "message"), frames })])
    }
    case "finish": {
      const status = pick(runStatuses.filter((s) => s !== "running"), v.status, "ok", "--status")
      return send(ctx, [{ type: "run.finished", status, title: v.title }])
    }
    default: {
      const unreachable: never = word
      return unreachable
    }
  }
}

function partInput(raw: unknown): ActivityPartInput {
  const parsed = ActivityPartInputSchema.safeParse(raw)
  if (!parsed.success) throw new UsageError(`--part is not a valid part: ${parsed.error.message}`)
  return parsed.data
}

function updateInput(raw: unknown): ActivityUpdate {
  const parsed = ActivityUpdateSchema.safeParse(raw)
  if (!parsed.success) throw new UsageError(`--update is not a valid update: ${parsed.error.message}`)
  return parsed.data
}

export async function stopCommand(ctx: CommandContext): Promise<number> {
  const thread = need(ctx.positionals[1], "thread or task id").replace(/^#/, "")
  const result = await run(sdk.stopRun({ path: { id: thread }, body: { member: ctx.values.member, reason: ctx.values.reason } }))
  ctx.print(result, () =>
    result.requests.map((r) => `${r.repeated ? "Already asked" : "Asked"} ${r.member} to stop in ${r.threadId}${r.entryIds.length ? ` (${r.entryIds.join(", ")})` : ""}`).join("\n"),
  )
  return 0
}

export function approvalAction(raw: string | undefined) {
  if (raw === undefined) return undefined
  const parsed = ApprovalActionSchema.safeParse(json(raw, "--action"))
  if (!parsed.success) throw new UsageError(`--action is not a valid action: ${parsed.error.message}`)
  return parsed.data
}
