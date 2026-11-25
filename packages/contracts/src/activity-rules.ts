import type { ActivityPart, ActivityPartInput, ActivityState, ActivityUpdate, FileChange, StackFrame } from "./activity"

export const activityPartTypes = ["tool", "terminal", "reasoning", "plan", "files", "tests", "subagent", "error"] as const
export const stepStatuses = ["running", "ok", "error"] as const
export const planStepStatuses = ["pending", "doing", "done"] as const
export const runStatuses = ["running", "ok", "error", "stopped"] as const
export const activityLimits = { text: 20_000, parts: 200, items: 200, updates: 100 } as const

export const activityEventTypes = { posted: "activity.posted", updated: "activity.updated", stopRequested: "run.stop_requested" } as const

export type ActivityPartType = (typeof activityPartTypes)[number]
export type StepStatus = (typeof stepStatuses)[number]
export type PlanStepStatus = (typeof planStepStatuses)[number]
export type RunStatus = (typeof runStatuses)[number]

const clipTail = (text: string) => (text.length > activityLimits.text ? text.slice(text.length - activityLimits.text) : text)

export type DiffLine = { kind: "hunk" | "added" | "removed" | "context"; text: string }

const diffHeader = /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |\\ No newline)/

export function diffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let inHunk = false
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) inHunk = false
    if (line.startsWith("\\ No newline") || (!inHunk && diffHeader.test(line))) continue
    if (line.startsWith("@@")) {
      inHunk = true
      lines.push({ kind: "hunk", text: line })
    } else if (line.startsWith("+")) lines.push({ kind: "added", text: line.slice(1) })
    else if (line.startsWith("-")) lines.push({ kind: "removed", text: line.slice(1) })
    else lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line })
  }
  return lines
}

export function countDiff(diff: string): { added: number; removed: number } {
  const lines = diffLines(diff)
  return { added: lines.filter((l) => l.kind === "added").length, removed: lines.filter((l) => l.kind === "removed").length }
}

export function normalizePart(input: ActivityPartInput, at: string, fallbackId: string): ActivityPart {
  const id = input.id ?? fallbackId
  const time = {
    status: "status" in input && input.status ? input.status : "running",
    startedAt: "startedAt" in input && input.startedAt ? input.startedAt : at,
    durationMs: "durationMs" in input && input.durationMs !== undefined ? input.durationMs : null,
  }
  switch (input.type) {
    case "tool":
      return { ...input, ...time, id, input: input.input ?? {}, output: clipTail(input.output ?? "") }
    case "terminal":
      return { ...input, ...time, id, cwd: input.cwd ?? null, output: clipTail(input.output ?? ""), exitCode: input.exitCode ?? null }
    case "reasoning":
      return { ...input, ...time, id, text: clipTail(input.text) }
    case "plan":
      return { ...input, id, title: input.title ?? null }
    case "files":
      return {
        ...input,
        id,
        files: input.files.map((file) => {
          const counted = file.diff ? countDiff(file.diff) : { added: 0, removed: 0 }
          return { path: file.path, added: file.added ?? counted.added, removed: file.removed ?? counted.removed, diff: file.diff ?? null }
        }),
      }
    case "tests":
      return {
        ...input,
        ...time,
        id,
        command: input.command ?? null,
        skipped: input.skipped ?? 0,
        suites: input.suites ?? [],
        failures: (input.failures ?? []).map((f) => ({ name: f.name, message: f.message, location: f.location ?? null })),
      }
    case "subagent":
      return { ...input, ...time, id, summary: clipTail(input.summary ?? "") }
    case "error":
      return {
        ...input,
        id,
        name: input.name ?? null,
        frames: (input.frames ?? []).map((f) => ({ function: f.function ?? null, file: f.file, line: f.line ?? null, column: f.column ?? null })),
      }
    default: {
      const unreachable: never = input
      return unreachable
    }
  }
}

function appendTo(part: ActivityPart, text: string): ActivityPart | null {
  switch (part.type) {
    case "tool":
    case "terminal":
      return { ...part, output: clipTail(part.output + text) }
    case "reasoning":
      return { ...part, text: clipTail(part.text + text) }
    case "subagent":
      return { ...part, summary: clipTail(part.summary + text) }
    case "plan":
    case "files":
    case "tests":
    case "error":
      return null
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}

const elapsed = (from: string, to: string) => Math.max(0, Date.parse(to) - Date.parse(from))

function finishPart(part: ActivityPart, end: { status: "ok" | "error"; at: string; output?: string; exitCode?: number; durationMs?: number }): ActivityPart {
  switch (part.type) {
    case "tool":
    case "subagent":
    case "reasoning":
    case "tests": {
      const timedPart = { ...part, status: end.status, durationMs: end.durationMs ?? part.durationMs ?? elapsed(part.startedAt, end.at) }
      if (timedPart.type === "tool" && end.output !== undefined) return { ...timedPart, output: clipTail(end.output) }
      return timedPart
    }
    case "terminal":
      return {
        ...part,
        status: end.status,
        durationMs: end.durationMs ?? part.durationMs ?? elapsed(part.startedAt, end.at),
        output: end.output === undefined ? part.output : clipTail(end.output),
        exitCode: end.exitCode ?? part.exitCode,
      }
    case "plan":
    case "files":
    case "error":
      return part
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}

const isRunning = (part: ActivityPart) => "status" in part && part.status === "running"

export type ActivityApply = { ok: true; state: ActivityState; applied: ActivityUpdate[] } | { ok: false; error: string }

export function applyActivityUpdates(state: ActivityState, updates: ActivityUpdate[], at: string): ActivityApply {
  let parts = state.parts
  let status = state.status
  let title = state.title
  let endedAt = state.endedAt
  const applied: ActivityUpdate[] = []
  for (const update of updates) {
    if (status !== "running") return { ok: false, error: `The run already ended (${status}); post a new entry instead` }
    switch (update.type) {
      case "part.set": {
        const part = normalizePart(update.part, at, `p${parts.length + 1}`)
        const index = parts.findIndex((p) => p.id === part.id)
        if (index === -1 && parts.length >= activityLimits.parts) return { ok: false, error: `An entry holds at most ${activityLimits.parts} parts; post a new entry` }
        parts = index === -1 ? [...parts, part] : parts.map((p, i) => (i === index ? part : p))
        applied.push({ type: "part.set", part })
        break
      }
      case "part.append": {
        const index = parts.findIndex((p) => p.id === update.partId)
        const current = parts[index]
        if (!current) return { ok: false, error: `No part ${update.partId} in this entry` }
        const next = appendTo(current, update.text)
        if (!next) return { ok: false, error: `A ${current.type} part takes no streamed text; send part.set with the whole part` }
        parts = parts.map((p, i) => (i === index ? next : p))
        applied.push(update)
        break
      }
      case "part.finished": {
        const index = parts.findIndex((p) => p.id === update.partId)
        const current = parts[index]
        if (!current) return { ok: false, error: `No part ${update.partId} in this entry` }
        const next = finishPart(current, { ...update, at })
        parts = parts.map((p, i) => (i === index ? next : p))
        applied.push({ ...update, durationMs: "durationMs" in next && next.durationMs !== null ? next.durationMs : update.durationMs })
        break
      }
      case "run.finished": {
        const partStatus = update.status === "ok" ? "ok" : "error"
        parts = parts.map((p) => (isRunning(p) ? finishPart(p, { status: partStatus, at }) : p))
        status = update.status
        title = update.title ?? title
        endedAt = at
        applied.push(update)
        break
      }
      default: {
        const unreachable: never = update
        return unreachable
      }
    }
  }
  return { ok: true, state: { ...state, parts, status, title, endedAt, revision: state.revision + 1, updatedAt: at }, applied }
}

export function startActivity(input: { title: string; runId: string | null; key: string | null; parts: ActivityPartInput[] }, at: string): ActivityApply {
  if (input.parts.length > activityLimits.parts) return { ok: false, error: `An entry holds at most ${activityLimits.parts} parts` }
  const parts = input.parts.map((part, i) => normalizePart(part, at, `p${i + 1}`))
  const ids = new Set(parts.map((p) => p.id))
  if (ids.size !== parts.length) return { ok: false, error: "Two parts share an id" }
  return {
    ok: true,
    state: { title: input.title, runId: input.runId, key: input.key, status: "running", revision: 1, updatedAt: at, endedAt: null, stopRequestedAt: null, parts },
    applied: [],
  }
}

const shortCommand = (command: string) => (command.length > 60 ? `${command.slice(0, 57)}...` : command)

export function partHeadline(part: ActivityPart): string {
  const running = isRunning(part)
  switch (part.type) {
    case "tool":
      return running ? `Using ${part.name}` : part.status === "error" ? `${part.name} failed` : `Used ${part.name}`
    case "terminal":
      if (running) return `Running ${shortCommand(part.command)}`
      return part.exitCode !== null && part.exitCode !== 0 ? `${shortCommand(part.command)} exited with ${part.exitCode}` : `Ran ${shortCommand(part.command)}`
    case "reasoning":
      return running ? "Thinking" : "Thought"
    case "plan": {
      const doing = part.steps.find((s) => s.status === "doing")
      const done = part.steps.filter((s) => s.status === "done").length
      return doing ? doing.text : `${part.title ?? "Plan"}: ${done} of ${part.steps.length} done`
    }
    case "files":
      return part.files.length === 1 ? `Changed ${part.files[0]?.path ?? "a file"}` : `Changed ${part.files.length} files`
    case "tests":
      if (running) return "Running tests"
      return part.failed ? `${part.failed} failed, ${part.passed} passed` : `${part.passed} passed`
    case "subagent":
      return running ? `${part.name}: ${part.task}` : `${part.name} finished`
    case "error":
      return part.name ? `${part.name}: ${part.message}` : part.message
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}

export function currentStep(entry: Pick<ActivityState, "parts" | "title" | "status">): string {
  const running = [...entry.parts].reverse().find(isRunning)
  if (running) return partHeadline(running)
  const plan = [...entry.parts].reverse().find((p) => p.type === "plan")
  if (plan && entry.status === "running") return partHeadline(plan)
  return entry.title
}

export function filesFromDiff(diff: string): FileChange[] {
  const files: FileChange[] = []
  const sections = diff.split(/^(?=diff --git )/m).filter((s) => s.trim() !== "")
  for (const section of sections) {
    const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(section)?.[1]
    const minus = /^--- (?:a\/)?(.+)$/m.exec(section)?.[1]
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(section)?.[2]
    const path = (plus && plus !== "/dev/null" ? plus : undefined) ?? (minus && minus !== "/dev/null" ? minus : undefined) ?? header
    if (!path) continue
    const counted = countDiff(section)
    files.push({ path: path.trim(), ...counted, diff: clipTail(section) })
  }
  return files
}

export function framesFromStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = []
  for (const raw of stack.split("\n")) {
    const line = raw.trim()
    const js = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line)
    if (js?.[2]) {
      frames.push({ function: js[1] ?? null, file: js[2], line: Number(js[3]), column: Number(js[4]) })
      continue
    }
    const py = /^File "(.+?)", line (\d+)(?:, in (.+))?$/.exec(line)
    if (py?.[1]) frames.push({ function: py[3] ?? null, file: py[1], line: Number(py[2]), column: null })
  }
  return frames.slice(0, activityLimits.items)
}
