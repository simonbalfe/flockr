import * as sdk from "@flockr/client"
import {
  actionKindRules,
  actionKinds,
  allowedVerdicts,
  approvalVerdicts,
  effectiveVerdict,
  type ActionKind,
  type ApprovalCheck,
  type ApprovalRule,
  type ApprovalRules,
  type ApprovalSource,
  type ApprovalVerdict,
} from "@flockr/client"
import { run } from "./api"
import { need, UsageError } from "./args"
import type { CommandContext } from "./activity"

const scopeText = (channel: string | null) => (channel === null ? "board" : `#${channel}`)

const sourceTexts = (channel: string | null) =>
  ({ channel: `${scopeText(channel)} rule`, board: "board rule", default: "default" }) satisfies Record<ApprovalSource, string>

function kindOf(raw: string | undefined): ActionKind {
  const kind = actionKinds.find((k) => k === raw)
  if (!kind) throw new UsageError(`Give an action kind: ${actionKinds.join(", ")}`)
  return kind
}

function verdictOf(raw: string, kind: ActionKind): ApprovalVerdict {
  const verdict = approvalVerdicts.find((v) => v === raw)
  if (!verdict) throw new UsageError(`Give a verdict: ${allowedVerdicts(kind).join(", ")}`)
  return verdict
}

export const ruleLine = (r: ApprovalRule) => `${r.kind.padEnd(8)} ${r.verdict.padEnd(6)} ${scopeText(r.channel).padEnd(12)} set by ${r.setBy} ${r.updatedAt}`

export function rulesText(list: ApprovalRules, channel: string | null): string {
  const kinds = list.kinds.map((k) => {
    const board = list.rules.find((r) => r.kind === k.kind && r.channel === null)
    const here = channel === null ? undefined : list.rules.find((r) => r.kind === k.kind && r.channel === channel)
    const { verdict, source } = effectiveVerdict(k.kind, { channel: here?.verdict ?? null, board: board?.verdict ?? null })
    return `${k.kind.padEnd(8)} ${verdict.padEnd(6)} ${sourceTexts(channel)[source].padEnd(16)} floor ${k.floor.padEnd(6)} ${k.label}`
  })
  const header = channel === null ? "Board-wide" : `In #${channel}`
  const rules = list.rules.length ? ["", "Rules set:", ...list.rules.map((r) => `  ${ruleLine(r)}`)] : ["", "No rules set; every kind has its default."]
  return [`${header} (kind, verdict, from, floor):`, ...kinds.map((line) => `  ${line}`), ...rules].join("\n")
}

const checkText = (c: ApprovalCheck) =>
  `${c.kind} in ${scopeText(c.channel)}: ${c.verdict} (${sourceTexts(c.channel)[c.source]}; floor ${c.floor}, ${actionKindRules[c.kind].label.toLowerCase()})`

export async function rulesCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1] ?? "list"
  const channel = values.channel?.replace(/^#/, "") ?? null
  switch (sub) {
    case "list": {
      const list = await run(sdk.listApprovalRules())
      print(list, () => rulesText(list, channel))
      return 0
    }
    case "check": {
      const kind = kindOf(positionals[2])
      const checked = await run(sdk.checkApproval({ query: { kind, channel: channel ?? undefined } }))
      print(checked, () => checkText(checked))
      return 0
    }
    case "set": {
      const kind = kindOf(positionals[2])
      const verdict = verdictOf(need(positionals[3], "verdict (allow, ask or block)"), kind)
      const rule = await run(sdk.setApprovalRule({ body: { kind, channel, verdict } }))
      print(rule, () => `Set ${ruleLine(rule)}`)
      return 0
    }
    case "clear": {
      const kind = kindOf(positionals[2])
      const cleared = await run(sdk.clearApprovalRule({ query: { kind, channel: channel ?? undefined } }))
      print(cleared, () => (cleared.cleared ? `Cleared the ${kind} rule for ${scopeText(channel)}` : `No ${kind} rule for ${scopeText(channel)}; nothing changed`))
      return 0
    }
    default:
      throw new UsageError(`Unknown command fc rules ${sub}`)
  }
}
