import { parseArgs } from "node:util"

export const flags = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  url: { type: "string" },
  as: { type: "string" },
  channel: { type: "string" },
  channels: { type: "string" },
  state: { type: "string" },
  assignee: { type: "string" },
  mine: { type: "boolean" },
  for: { type: "string" },
  needs: { type: "string" },
  label: { type: "string", multiple: true },
  kind: { type: "string" },
  spec: { type: "string" },
  text: { type: "string" },
  ready: { type: "boolean" },
  wait: { type: "boolean" },
  timeout: { type: "string" },
  reason: { type: "string" },
  commit: { type: "string" },
  message: { type: "string" },
  repo: { type: "string" },
  note: { type: "string" },
  epoch: { type: "string" },
  option: { type: "string", multiple: true },
  detail: { type: "string" },
  since: { type: "string" },
  thread: { type: "string" },
  data: { type: "string" },
  owner: { type: "string" },
  "runs-in": { type: "string" },
  topic: { type: "string" },
  visibility: { type: "string" },
  mentions: { type: "boolean" },
  org: { type: "string" },
  keep: { type: "boolean" },
  clear: { type: "boolean" },
  part: { type: "string", multiple: true },
  update: { type: "string", multiple: true },
  revision: { type: "string" },
  run: { type: "string" },
  key: { type: "string" },
  input: { type: "string" },
  output: { type: "string" },
  status: { type: "string" },
  duration: { type: "string" },
  id: { type: "string" },
  step: { type: "string", multiple: true },
  diff: { type: "string" },
  stack: { type: "string" },
  passed: { type: "string" },
  failed: { type: "string" },
  skipped: { type: "string" },
  failure: { type: "string", multiple: true },
  command: { type: "string" },
  member: { type: "string" },
  title: { type: "string" },
  exit: { type: "string" },
  harness: { type: "string" },
  folder: { type: "string" },
  permissions: { type: "string" },
  personality: { type: "string" },
  model: { type: "string" },
  machine: { type: "string" },
  action: { type: "string" },
  limit: { type: "string" },
  cron: { type: "string" },
  event: { type: "string" },
  agent: { type: "string" },
  "per-hour": { type: "string" },
  name: { type: "string" },
  tag: { type: "string", multiple: true },
  archived: { type: "boolean" },
  before: { type: "string" },
  task: { type: "string" },
  refuse: { type: "boolean" },
  tests: { type: "string" },
  reviewer: { type: "string" },
  to: { type: "string" },
  "up-to": { type: "string" },
  file: { type: "string" },
  files: { type: "string" },
  block: { type: "string", multiple: true },
  decision: { type: "string" },
  why: { type: "string" },
  replaces: { type: "string" },
  version: { type: "string" },
  "review-needs-person": { type: "string" },
  next: { type: "string", multiple: true },
  closed: { type: "boolean" },
  goal: { type: "string" },
  plan: { type: "string" },
} as const

export function readArgs(argv: string[]) {
  return parseArgs({ args: argv, options: flags, allowPositionals: true, strict: true })
}

export type Args = ReturnType<typeof readArgs>
export type Values = Args["values"]

export class UsageError extends Error {}

export function need(value: string | undefined, what: string): string {
  if (value === undefined || value === "") throw new UsageError(`Missing ${what}`)
  return value
}

export function int(value: string | undefined, what: string): number {
  const n = Number(need(value, what).replace(/^#/, ""))
  if (!Number.isInteger(n)) throw new UsageError(`${what} must be a whole number, got ${value}`)
  return n
}

export function optionalInt(value: string | undefined, what: string): number | undefined {
  return value === undefined ? undefined : int(value, what)
}

export function seconds(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--timeout must be seconds, got ${value}`)
  return n
}

export function yesNoOf(value: string | undefined, what: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === "yes") return true
  if (value === "no") return false
  throw new UsageError(`${what} must be yes or no, got ${value}`)
}
