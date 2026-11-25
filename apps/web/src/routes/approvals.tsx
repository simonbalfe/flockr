import { approvalVerdictLabels, approvalVerdicts, effectiveVerdict, verdictAllowed, type ActionKindInfo, type ApprovalRule, type ApprovalSource, type ApprovalVerdict } from "@flockr/client"
import { useState } from "react"
import { toast } from "sonner"
import { useClearApprovalRule, useApprovalRules, useMayManageApprovalRules, useSetApprovalRule } from "@/api/approvals"
import { errorText, useChannelList } from "@/api/hooks"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const wholeBoard = ""

const fieldClass = "h-8  border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

const sourceTexts = (channel: string | null) =>
  ({ channel: `Set for #${channel ?? ""}`, board: channel === null ? "Set for the whole board" : "From the whole board", default: "Default" }) satisfies Record<ApprovalSource, string>

function VerdictControl({ info, value, disabled, onPick }: { info: ActionKindInfo; value: ApprovalVerdict; disabled: boolean; onPick: (verdict: ApprovalVerdict) => void }) {
  return (
    <div role="radiogroup" aria-label={info.label} className="inline-flex bg-muted p-[3px]">
      {approvalVerdicts.map((verdict) => {
        const allowed = verdictAllowed(info.kind, verdict)
        const chosen = verdict === value
        return (
          <button
            key={verdict}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled || !allowed}
            title={allowed ? undefined : `${info.label} is never looser than ${info.floor}`}
            onClick={() => !chosen && onPick(verdict)}
            className={cn(
              "h-7 min-w-14  px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
              chosen && "bg-background text-foreground shadow-sm",
            )}
          >
            {approvalVerdictLabels[verdict]}
          </button>
        )
      })}
    </div>
  )
}

function KindRow({ info, channel, rules, mayManage }: { info: ActionKindInfo; channel: string | null; rules: ApprovalRule[]; mayManage: boolean }) {
  const set = useSetApprovalRule()
  const clear = useClearApprovalRule()
  const board = rules.find((r) => r.kind === info.kind && r.channel === null)
  const here = channel === null ? board : rules.find((r) => r.kind === info.kind && r.channel === channel)
  const { verdict, source } = effectiveVerdict(info.kind, { channel: channel === null ? null : (here?.verdict ?? null), board: board?.verdict ?? null })
  const onError = (error: unknown) => void toast(errorText(error))
  const pending = set.isPending || clear.isPending
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{info.label}</div>
        <div className="text-xs text-muted-foreground">
          {sourceTexts(channel)[source]}
          {!verdictAllowed(info.kind, "allow") && ` · Always at least ${approvalVerdictLabels[info.floor].toLowerCase()}`}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {here && (
          <Button variant="ghost" size="sm" disabled={!mayManage || pending} onClick={() => clear.mutate({ kind: info.kind, channel }, { onError })}>
            Reset
          </Button>
        )}
        <VerdictControl info={info} value={verdict} disabled={!mayManage || pending} onPick={(picked) => set.mutate({ kind: info.kind, channel, verdict: picked }, { onError })} />
      </div>
    </li>
  )
}

export function ApprovalsView() {
  const rules = useApprovalRules()
  const channels = useChannelList()
  const mayManage = useMayManageApprovalRules()
  const [scope, setScope] = useState(wholeBoard)
  const channel = scope === wholeBoard ? null : scope
  const data = rules.data
  return (
    <>
      <PageHeader title="Approval rules">
        <select className={fieldClass} aria-label="Where the rules hold" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value={wholeBoard}>Whole board</option>
          {(channels.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              #{c.id}
            </option>
          ))}
        </select>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">
          {data ? (
            <ul className="grid gap-6 pt-2">
              {data.kinds.map((info) => (
                <KindRow key={info.kind} info={info} channel={channel} rules={data.rules} mayManage={mayManage} />
              ))}
            </ul>
          ) : (
            <div className="py-2 text-sm text-faint">Loading</div>
          )}
          {!mayManage && <p className="pt-6 text-xs text-muted-foreground">Only a person can change approval rules.</p>}
        </div>
      </ScrollArea>
    </>
  )
}
