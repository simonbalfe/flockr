import { z } from "@hono/zod-openapi"
import type { RoutineActionKind } from "./routines"

export const approvalVerdicts = ["allow", "ask", "block"] as const
export type ApprovalVerdict = (typeof approvalVerdicts)[number]

export const actionKinds = ["post", "task", "mention", "brief", "command", "spend", "prod"] as const
export type ActionKind = (typeof actionKinds)[number]

export const approvalSources = ["channel", "board", "default"] as const
export type ApprovalSource = (typeof approvalSources)[number]

export interface ActionKindRule {
  label: string
  floor: ApprovalVerdict
  default: ApprovalVerdict
}

export const actionKindRules = {
  post: { label: "Post a message", floor: "allow", default: "allow" },
  task: { label: "Create a task", floor: "allow", default: "allow" },
  mention: { label: "Mention an agent", floor: "allow", default: "allow" },
  brief: { label: "Post the morning brief", floor: "allow", default: "allow" },
  command: { label: "Run a shell command", floor: "allow", default: "ask" },
  spend: { label: "Spend money", floor: "ask", default: "ask" },
  prod: { label: "Change prod", floor: "ask", default: "ask" },
} as const satisfies Record<ActionKind, ActionKindRule>

export const routineActionKind = { post: "post", task: "task", mention: "mention", brief: "brief" } as const satisfies Record<RoutineActionKind, ActionKind>

export const approvalVerdictLabels = { allow: "Allow", ask: "Ask", block: "Block" } as const satisfies Record<ApprovalVerdict, string>

export const approvalOptions = { allow: "Allow once", deny: "Deny" } as const

export const approvalEventTypes = { set: "approval_rule.set", cleared: "approval_rule.cleared" } as const

export const verdictRank = { allow: 0, ask: 1, block: 2 } as const satisfies Record<ApprovalVerdict, number>

export const stricterVerdict = (a: ApprovalVerdict, b: ApprovalVerdict): ApprovalVerdict => (verdictRank[a] >= verdictRank[b] ? a : b)

export const verdictAllowed = (kind: ActionKind, verdict: ApprovalVerdict): boolean => verdictRank[verdict] >= verdictRank[actionKindRules[kind].floor]

export const allowedVerdicts = (kind: ActionKind): ApprovalVerdict[] => approvalVerdicts.filter((v) => verdictAllowed(kind, v))

export interface ScopedVerdicts {
  channel: ApprovalVerdict | null
  board: ApprovalVerdict | null
}

export function effectiveVerdict(kind: ActionKind, rules: ScopedVerdicts): { verdict: ApprovalVerdict; source: ApprovalSource } {
  const source: ApprovalSource = rules.channel !== null ? "channel" : rules.board !== null ? "board" : "default"
  const chosen = rules.channel ?? rules.board ?? actionKindRules[kind].default
  return { verdict: stricterVerdict(chosen, actionKindRules[kind].floor), source }
}

const timestamp = z.string().openapi({ format: "date-time", example: "2026-11-25T08:00:00.000Z" })

export const ApprovalVerdictSchema = z.enum(approvalVerdicts).openapi("ApprovalVerdict", {
  description: "allow: it runs. ask: it waits for a person to answer a question card. block: it does not run.",
})
export const ActionKindSchema = z.enum(actionKinds).openapi("ActionKind", {
  description: "post a message, create a task, mention an agent, post the morning brief, run a shell command, spend money, change prod",
})

const channelScope = z
  .string()
  .min(1)
  .nullable()
  .default(null)
  .openapi({ example: "backend", description: "The channel the rule holds in; null for the whole board. A channel rule beats the board rule" })

export const ActionKindInfo = z
  .object({
    kind: ActionKindSchema,
    label: z.string().openapi({ example: "Spend money" }),
    floor: ApprovalVerdictSchema.openapi({ description: "The most permissive verdict a rule may set; spending money and changing prod are at least ask" }),
    default: ApprovalVerdictSchema.openapi({ description: "The verdict with no rule" }),
  })
  .openapi("ActionKindInfo")

export const ApprovalRule = z
  .object({
    kind: ActionKindSchema,
    channel: z.string().nullable().openapi({ description: "null for the whole board" }),
    verdict: ApprovalVerdictSchema,
    setBy: z.string(),
    updatedAt: timestamp,
  })
  .openapi("ApprovalRule")

export const ApprovalRules = z
  .object({
    kinds: z.array(ActionKindInfo).openapi({ description: "Every action kind with its floor and default" }),
    rules: z.array(ApprovalRule).openapi({ description: "The rules people have set, board-wide first" }),
  })
  .openapi("ApprovalRules")

export const SetApprovalRuleBody = z
  .object({ kind: ActionKindSchema, channel: channelScope, verdict: ApprovalVerdictSchema })
  .openapi("SetApprovalRuleBody")

export const ApprovalScopeQuery = z.object({
  kind: ActionKindSchema,
  channel: z.string().min(1).optional().openapi({ example: "backend", description: "Left out, the whole board" }),
})

export const ApprovalCheck = z
  .object({
    kind: ActionKindSchema,
    channel: z.string().nullable(),
    verdict: ApprovalVerdictSchema.openapi({ description: "What happens: the stricter of the rule (or the default) and the floor" }),
    source: z.enum(approvalSources).openapi("ApprovalSource", { description: "Where the verdict came from: the channel's rule, the board rule, or the default" }),
    floor: ApprovalVerdictSchema,
    rule: ApprovalRule.nullable().openapi({ description: "The rule that applied; null for the default" }),
  })
  .openapi("ApprovalCheck")

export const ClearedApprovalRule = z
  .object({ kind: ActionKindSchema, channel: z.string().nullable(), cleared: z.boolean().openapi({ description: "false when there was no rule to clear" }) })
  .openapi("ClearedApprovalRule")

export type ApprovalRule = z.infer<typeof ApprovalRule>
export type ApprovalRules = z.infer<typeof ApprovalRules>
export type ActionKindInfo = z.infer<typeof ActionKindInfo>
export type SetApprovalRuleBody = z.infer<typeof SetApprovalRuleBody>
export type ApprovalScopeQuery = z.infer<typeof ApprovalScopeQuery>
export type ApprovalCheck = z.infer<typeof ApprovalCheck>
export type ClearedApprovalRule = z.infer<typeof ClearedApprovalRule>
