import { accessLevelLabels, grantsOf, type AccessGrant, type AccessLevel } from "@flockr/contracts"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { forbidden } from "../board/errors"
import type { Executor } from "../db/client"
import { members } from "../db/schema"

export type Need = "read" | AccessGrant

export const mcpTransport = "mcpTransport"

const reads = [mcpTransport, "markRead", "saveDraft", "saveMessage", "unsaveMessage", "signOut", "requestSignInLink", "saveSessionChunk", "openSavedSession"] as const

const replies = [
  "postMessage",
  "replyToThread",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "openDirectMessage",
  "askInThread",
  "answerInThread",
  "setActivity",
  "createActivityEntry",
  "updateActivityEntry",
  "uploadFile",
  "schedulePost",
  "cancelScheduledPost",
] as const

const work = [
  "createTask",
  "claimNextTask",
  "claimTask",
  "answerQuestion",
  "approveTask",
  "askQuestion",
  "blockTask",
  "unblockTask",
  "cancelTask",
  "requestChanges",
  "addTaskCommit",
  "completeTask",
  "failTask",
  "giveTask",
  "handOffTask",
  "releaseTask",
  "renewTask",
  "reopenTask",
  "submitForReview",
  "setTaskPlan",
  "setTaskReviewer",
  "makeTaskFromThread",
  "stopRun",
  "createPlan",
  "updatePlan",
  "closePlan",
  "reopenPlan",
  "declareArea",
  "releaseArea",
  "renewArea",
  "importChecklist",
  "addChannelMemory",
  "updateChannelMemory",
  "archiveChannelMemory",
  "restoreChannelMemory",
  "addAgentNote",
  "updateAgentNote",
  "archiveAgentNote",
  "restoreAgentNote",
  "editChannelDocument",
] as const

const needs = new Map<string, Need>([...reads.map((id) => [id, "read"] as const), ...replies.map((id) => [id, "reply"] as const), ...work.map((id) => [id, "work"] as const)])

export const classifiedOperations = (): string[] => [...needs.keys()]

export const needOf = (operation: { method: string; operationId: string | null }): Need => {
  if (operation.method === "GET" || operation.method === "HEAD") return "read"
  return (operation.operationId && needs.get(operation.operationId)) || "manage"
}

const needWording = { read: "read", reply: "post or reply", work: "work on tasks, plans or memory", manage: "manage the board" } as const satisfies Record<Need, string>

interface Route {
  method: string
  pattern: RegExp
  operationId: string
  params: number
}

const Paths = z.record(z.string(), z.record(z.string(), z.unknown()))
const Operation = z.object({ operationId: z.string() })

export function operationMatcher(document: unknown): (method: string, pathname: string) => string | null {
  const paths = Paths.parse(z.object({ paths: z.unknown() }).parse(document).paths)
  const routes: Route[] = []
  for (const [path, operations] of Object.entries(paths)) {
    const pattern = new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^/}]+\}/g, "[^/]+")}$`)
    const params = (path.match(/\{/g) ?? []).length
    for (const [method, operation] of Object.entries(operations)) {
      const parsed = Operation.safeParse(operation)
      if (parsed.success) routes.push({ method: method.toUpperCase(), pattern, operationId: parsed.data.operationId, params })
    }
  }
  routes.sort((a, b) => a.params - b.params)
  return (method, pathname) => routes.find((route) => route.method === method && route.pattern.test(pathname))?.operationId ?? null
}

export async function grantsOfMember(db: Executor, name: string): Promise<{ level: AccessLevel; grants: AccessGrant[] } | null> {
  const [row] = await db.select({ kind: members.kind, access: members.access, grants: members.accessGrants }).from(members).where(eq(members.name, name))
  if (!row || row.kind !== "agent") return null
  return { level: row.access, grants: grantsOf(row.access, row.grants) }
}

export const permits = (grants: readonly AccessGrant[] | null, need: Need): boolean => need === "read" || grants === null || grants.includes(need)

export async function requireAccess(db: Executor, member: string, operation: { method: string; operationId: string | null }): Promise<AccessGrant[] | null> {
  const access = await grantsOfMember(db, member)
  if (!access) return null
  const need = needOf(operation)
  if (!permits(access.grants, need)) {
    throw forbidden(`${member} has ${accessLevelLabels[access.level].toLowerCase()} access; it cannot ${needWording[need]}. A person changes it with flockr agents access ${member} <level>`)
  }
  return access.grants
}

const provisioningOperations = new Set(["whoami", "listKeys", "createKey", "revokeKey", "rotateKey", "rescopeKey", "listMembers", "listChannels"])

export function requireProvisioningOperation(operationId: string | null): void {
  if (operationId && provisioningOperations.has(operationId)) return
  throw forbidden("A provisioning key only makes, lists, rotates, rescopes and revokes agent keys; use a member key or sign in for anything else")
}
