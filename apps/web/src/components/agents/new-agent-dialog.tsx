import { agentLimits, agentNamePattern, agentPermissions, agentPresets, defaultAgentPermissions, permissionLabels, presetOf, runnerCommand, type AgentPermissions, type AgentPreset, type Machine } from "@flockr/client"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useCreateAgent, useMachines } from "@/api/agents"
import { useAgents } from "@/api/hooks"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePanel } from "@/lib/panel"
import { cn } from "@/lib/utils"
import { CopyCommand } from "./copy-command"
import { setNewAgentOpen, useNewAgentOpen } from "./new-agent-store"

export const fieldClass = "h-8 w-full  border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
const labelClass = "grid gap-1.5 text-[13px] font-medium"
const hintClass = "text-xs font-normal text-muted-foreground"

export function PermissionChoice({ value, onChange }: { value: AgentPermissions; onChange: (next: AgentPermissions) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium">Permissions</legend>
      {agentPermissions.map((option) => (
        <label
          key={option}
          className={cn("flex cursor-pointer items-start gap-2.5  border px-3 py-2.5 text-[13px]", value === option ? "border-foreground/40 bg-muted" : "hover:bg-muted/60")}
        >
          <input type="radio" name="permissions" className="mt-[3px] size-3.5 flex-none appearance-none border border-foreground/50 checked:border-foreground checked:bg-foreground checked:shadow-[inset_0_0_0_2px_var(--color-popover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={value === option} onChange={() => onChange(option)} />
          <span className="grid gap-0.5">
            <span className="font-medium">{permissionLabels[option].label}</span>
            <span className="text-muted-foreground">{permissionLabels[option].explanation}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function NoRunner() {
  return (
    <div className="grid gap-3 bg-muted px-4 py-4 text-[13px]">
      <div className="font-medium">No runner is connected</div>
      <p className="text-muted-foreground">An agent needs a machine to run on. Start a runner on the machine that should run it, then come back here.</p>
      <CopyCommand command={runnerCommand} />
    </div>
  )
}

const nameProblem = (name: string) => {
  if (!name) return null
  if (name.length < agentLimits.nameMin || name.length > agentLimits.nameMax) return `${agentLimits.nameMin} to ${agentLimits.nameMax} characters`
  if (!agentNamePattern.test(name)) return "Lowercase letters, digits and dashes, starting with a letter"
  return null
}

function CreateForm({ machines, onDone }: { machines: Machine[]; onDone: () => void }) {
  const agents = useAgents()
  const create = useCreateAgent()
  const { openAgent } = usePanel()
  const lastFolder = (agents.data ?? []).flatMap((a) => (a.config ? [a.config.folder] : [])).at(-1) ?? ""
  const [name, setName] = useState("")
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "")
  const machine = machines.find((m) => m.id === machineId) ?? machines[0]
  const [harnessId, setHarnessId] = useState<string | null>(null)
  const harness = machine?.harnesses.find((h) => h.id === harnessId) ?? machine?.harnesses[0]
  const [folder, setFolder] = useState<string | null>(null)
  const chosenFolder = folder ?? lastFolder
  const [permissions, setPermissions] = useState<AgentPermissions>(defaultAgentPermissions)
  const [personality, setPersonality] = useState("")
  const preset = presetOf(personality)
  const pickPreset = (option: AgentPreset) => {
    if (preset?.id === option.id) return setPersonality("")
    setPersonality(option.personality)
    if (!name) setName(option.id)
  }
  const problem = nameProblem(name)
  const hosted = machine?.hosted === true
  const ready = name !== "" && problem === null && machine !== undefined && harness !== undefined && (hosted || chosenFolder.startsWith("/"))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready || !machine || !harness) return
    create.mutate(
      { name, harness: harness.id, machine: machine.id, folder: hosted ? undefined : chosenFolder.trim(), permissions, personality: personality.trim() || null },
      {
        onSuccess: (agent) => {
          toast(`Created ${agent.name}. Mention @${agent.name} to start a conversation.`)
          onDone()
          openAgent(agent.name)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className={labelClass}>
        Name
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="scout" autoFocus spellCheck={false} autoComplete="off" />
        <span className={cn(hintClass, problem && "text-destructive")}>{problem ?? `People mention it as @${name || "name"}.`}</span>
      </label>
      {machines.length > 1 ? (
        <label className={labelClass}>
          Machine
          <select className={fieldClass} value={machine?.id ?? ""} onChange={(e) => setMachineId(e.target.value)}>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flex items-center justify-between bg-muted px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">Runs on</span>
          <span className="font-medium">{machine?.name}</span>
        </div>
      )}
      <label className={labelClass}>
        Harness
        {machine && machine.harnesses.length ? (
          <select className={fieldClass} value={harness?.id ?? ""} onChange={(e) => setHarnessId(e.target.value)}>
            {machine.harnesses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        ) : (
          <span className={hintClass}>{machine?.name} reports no harness it can run.</span>
        )}
      </label>
      {hosted ? (
        <span className={hintClass}>{machine?.name} is hosted by the board: the agent uses board tools only, has no folder and answers with every laptop shut.</span>
      ) : (
        <label className={labelClass}>
          Folder
          <input className={cn(fieldClass, "font-mono text-[13px]")} value={chosenFolder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/code/project" spellCheck={false} autoComplete="off" />
          <span className={hintClass}>An absolute path on {machine?.name ?? "the machine"}. The agent reads and works here.</span>
        </label>
      )}
      <PermissionChoice value={permissions} onChange={setPermissions} />
      <div className={labelClass}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="new-agent-personality">
            Personality <span className="font-normal text-faint">optional</span>
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="Personality presets">
            {agentPresets.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={preset?.id === option.id}
                onClick={() => pickPreset(option)}
                className={cn("h-6  border px-2 text-xs font-normal", preset?.id === option.id ? "border-foreground/40 bg-muted" : "text-muted-foreground hover:bg-muted/60")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          id="new-agent-personality"
          className={cn(fieldClass, "h-auto resize-y py-2", preset ? "min-h-[160px]" : "min-h-[64px]")}
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="You review pull requests and keep answers short."
          maxLength={agentLimits.personalityMax}
        />
        {preset ? <span className={hintClass}>{preset.summary}</span> : null}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!ready || create.isPending}>
          {create.isPending ? "Creating..." : "Create and start"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function NewAgentBody() {
  const machines = useMachines({ fresh: true })
  const online = (machines.data ?? []).filter((m) => m.online)
  if (machines.isPending) return <div className="h-24" />
  if (!online.length) return <NoRunner />
  return <CreateForm key={online.map((m) => m.id).join()} machines={online} onDone={() => setNewAgentOpen(false)} />
}

export function NewAgentDialog() {
  const open = useNewAgentOpen()
  return (
    <Dialog open={open} onOpenChange={setNewAgentOpen}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription className="sr-only">A new member of the board. It starts working the first time someone talks to it.</DialogDescription>
        </DialogHeader>
        <NewAgentBody />
      </DialogContent>
    </Dialog>
  )
}
