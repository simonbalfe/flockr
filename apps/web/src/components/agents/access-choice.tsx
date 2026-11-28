import { accessGrantLabels, accessGrants, accessLevelLabels, accessLevels, type AccessGrant, type AccessLevel, type Member } from "@flockr/client"
import { useState } from "react"
import { toast } from "sonner"
import { useSetAgentAccess } from "@/api/agents"
import { Button } from "@/components/ui/button"
import { fieldClass } from "./new-agent-dialog"

const levelHints = {
  read: "Reads the channels it is in. Cannot post, reply or touch tasks.",
  reply: "Reads, posts and replies. Cannot take tasks or change memory.",
  full: "Everything an agent may do on the board.",
  custom: "Reads, plus what you pick below.",
} as const satisfies Record<AccessLevel, string>

export function accessText(member: Pick<Member, "access" | "grants">): string {
  if (member.access !== "custom") return accessLevelLabels[member.access]
  return member.grants.length ? `Custom: reads, ${member.grants.join(", ")}` : "Custom: reads only"
}

export function AccessChoice({ agent }: { agent: Pick<Member, "name" | "access" | "grants"> }) {
  const set = useSetAgentAccess()
  const [level, setLevel] = useState<AccessLevel>(agent.access)
  const [grants, setGrants] = useState<AccessGrant[]>(agent.grants)
  const changed = level !== agent.access || (level === "custom" && grants.join() !== agent.grants.join())
  const toggle = (grant: AccessGrant) => setGrants((list) => accessGrants.filter((g) => (g === grant ? !list.includes(g) : list.includes(g))))
  const save = () =>
    set.mutate(
      { name: agent.name, level, grants: level === "custom" ? grants : undefined },
      { onSuccess: () => toast(`${agent.name} now has ${accessLevelLabels[level].toLowerCase()} access, on every key and sign-in.`) },
    )
  return (
    <div className="grid gap-1.5">
      <label className="grid gap-1.5 text-[13px] font-medium">
        Board access
        <select className={fieldClass} value={level} onChange={(event) => setLevel(accessLevels.find((l) => l === event.target.value) ?? level)}>
          {accessLevels.map((l) => (
            <option key={l} value={l}>
              {accessLevelLabels[l]}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-muted-foreground">{levelHints[level]}</span>
      {level === "custom" && (
        <div className="flex flex-wrap gap-1.5">
          {accessGrants.map((grant) => (
            <Button key={grant} type="button" size="sm" variant={grants.includes(grant) ? "default" : "outline"} aria-pressed={grants.includes(grant)} title={accessGrantLabels[grant]} onClick={() => toggle(grant)}>
              {grant}
            </Button>
          ))}
        </div>
      )}
      {changed && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLevel(agent.access)
              setGrants(agent.grants)
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={set.isPending}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
