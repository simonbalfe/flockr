import { z } from "@hono/zod-openapi"

export const areaPolicies = ["warn", "refuse"] as const
export type AreaPolicy = (typeof areaPolicies)[number]

export const areaLimits = { maxPaths: 20, pathChars: 200, noteChars: 300, defaultMinutes: 60 } as const

export const areaEndReasons = ["released", "task_ended", "expired"] as const
export type AreaEndReason = (typeof areaEndReasons)[number]

export const taskBranchPrefix = "flockr/"

export const taskBranch = (taskId: number): string => `${taskBranchPrefix}${taskId}`

const branchPattern = /^flockr\/(\d+)(?:$|[-/])/

export function taskOfBranch(branch: string): number | null {
  const match = branchPattern.exec(branch)
  return match?.[1] ? Number(match[1]) : null
}

export function normalizeAreaPath(raw: string): string | null {
  const path = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/")
  if (path === "" || path === "." || path.split("/").includes("..")) return null
  return path
}

const globChars = /[*?[\]{}]/

const hasGlob = (segment: string) => globChars.test(segment)

function segmentPattern(glob: string): RegExp {
  const body = glob
    .replace(/[.+^$()|\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
  return new RegExp(`^${body}$`)
}

function segmentsMayMatch(a: string, b: string): boolean {
  const globA = hasGlob(a)
  const globB = hasGlob(b)
  if (!globA && !globB) return a === b
  if (globA && globB) return true
  return globA ? segmentPattern(a).test(b) : segmentPattern(b).test(a)
}

// A folder covers everything under it, and `**` covers any depth, so two paths overlap when
// no segment of their shared depth rules them apart. A glob against a glob is assumed to overlap.
export function pathsOverlap(a: string, b: string): boolean {
  const left = a.split("/")
  const right = b.split("/")
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i += 1) {
    const x = left[i] ?? ""
    const y = right[i] ?? ""
    if (x === "**" || y === "**") return true
    if (!segmentsMayMatch(x, y)) return false
  }
  return true
}

export interface PathOverlap {
  yours: string
  theirs: string
}

export function overlappingPaths(yours: readonly string[], theirs: readonly string[]): PathOverlap[] {
  return yours.flatMap((mine) => theirs.filter((other) => pathsOverlap(mine, other)).map((other) => ({ yours: mine, theirs: other })))
}

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-25T10:40:02.000Z" })

export const AreaPolicySchema = z.enum(areaPolicies).openapi("AreaPolicy")

export const WorkingArea = z
  .object({
    id: z.number().int().openapi({ example: 12 }),
    channel: z.string().openapi({ example: "backend" }),
    owner: z.string().openapi({ example: "claude" }),
    taskId: z.number().int().nullable().openapi({ description: "The task this area belongs to; it ends with the task's claim. Null for an area with its own expiry" }),
    branch: z.string().nullable().openapi({ example: "flockr/806", description: "The task's branch; null for an area with no task" }),
    paths: z.array(z.string()).openapi({ example: ["apps/server/src/board", "packages/contracts/**"], description: "Files, folders or globs, relative to the channel's repo" }),
    note: z.string().nullable(),
    expiresAt: timestamp.nullable().openapi({ description: "When an area with no task runs out unless renewed; null while a task holds it" }),
    createdAt: timestamp,
  })
  .openapi("WorkingArea")

export const AreaOverlap = z
  .object({
    area: WorkingArea,
    paths: z.array(z.object({ yours: z.string(), theirs: z.string() })).openapi({ description: "Which of your paths meets which of theirs" }),
  })
  .openapi("AreaOverlap")

export const DeclareAreaResult = z
  .object({
    area: WorkingArea,
    overlaps: z.array(AreaOverlap).openapi({ description: "Other members' live areas that meet yours: who, which task, which paths. Empty when nothing meets. With overlap refuse, any overlap is a 409 instead" }),
  })
  .openapi("DeclareAreaResult")

export type WorkingArea = z.infer<typeof WorkingArea>
export type AreaOverlap = z.infer<typeof AreaOverlap>
export type DeclareAreaResult = z.infer<typeof DeclareAreaResult>
