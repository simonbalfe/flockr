import { mayManageAgent, permissionLabels, type ActivityEntry, type AgentConfig, type AgentDesired, type AgentDetail, type AgentPermissions } from "@flockr/client"
import { Ellipsis } from "lucide-react"
import { DropdownMenu } from "radix-ui"
import { useState } from "react"
import { toast } from "sonner"
import { useDeleteAgent, usePauseAgent, useResumeAgent, useStartAgent, useStopAgent, useUpdateAgent } from "@/api/agents"
import { useAgent, useAgentActivity, useInbox, useMembers } from "@/api/hooks"
import { currentUser } from "@/api/session"
import { useMayManageKeys } from "@/api/auth"
import { WorkBlock } from "@/components/agent/work-block"
import { KeyList, NewKeyDialog } from "@/components/keys/keys"
import { MemberAvatar } from "@/components/member-avatar"
import { KeyValueList, PanelFrame } from "@/components/panel-frame"
import { QuestionCard, ThreadQuestionCard } from "@/components/question-card"
import { TaskRow } from "@/components/task-row"
import { Button } from "@/components/ui/button"
import { usePanel } from "@/lib/panel"
import { clock } from "@/lib/time"
import { cn } from "@/lib/utils"
import { fieldClass, PermissionChoice } from "./new-agent-dialog"
import { AgentStatusShape, statusText } from "./status-dot"

export function useMayManageAgents(): boolean {
  const members = useMembers()
  const me = members.data?.find((m) => m.name === currentUser)
  return me ? mayManageAgent(me) : false
}

const sectionClass = "mt-1.5 text-[13px] font-semibold text-muted-foreground"

function Settings({ name, config, editable }: { name: string; config: AgentConfig; editable: boolean }) {
  const update = useUpdateAgent()
  const [folder, setFolder] = useState(config.folder)
  const [permissions, setPermissions] = useState<AgentPermissions>(config.permissions)
  const [personality, setPersonality] = useState(config.personality ?? "")
  const changed = folder.trim() !== config.folder || permissions !== config.permissions || personality.trim() !== (config.personality ?? "")
  const reset = () => {
    setFolder(config.folder)
    setPermissions(config.permissions)
    setPersonality(config.personality ?? "")
  }
  const save = () =>
    update.mutate(
      {
        name,
        folder: folder.trim() === config.folder ? undefined : folder.trim(),
        permissions: permissions === config.permissions ? undefined : permissions,
        personality: personality.trim() === (config.personality ?? "") ? undefined : personality.trim() || null,
      },
      { onSuccess: () => toast(`Saved. ${name}'s next session uses it.`) },
    )
  if (!editable) {
    return (
      <>
        <div className={sectionClass}>Personality</div>
        <p className="rounded-[10px] bg-muted px-3 py-[9px] text-[13px] whitespace-pre-wrap text-muted-foreground">{config.personality ?? "None"}</p>
      </>
    )
  }
  return (
    <div className="grid gap-3">
      <div className={sectionClass}>Settings</div>
      <label className="grid gap-1.5 text-[13px] font-medium">
        Folder
        <input className={cn(fieldClass, "font-mono text-[13px]")} value={folder} onChange={(e) => setFolder(e.target.value)} spellCheck={false} />
      </label>
      <PermissionChoice value={permissions} onChange={setPermissions} />
      <label className="grid gap-1.5 text-[13px] font-medium">
        Personality
        <textarea
          className={cn(fieldClass, "h-auto min-h-[72px] resize-y py-2")}
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="Its role or tone, added to its instructions"
        />
      </label>
      {changed && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={reset}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={update.isPending || !folder.trim().startsWith("/")}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}

function MoreMenu({ name }: { name: string }) {
  const remove = useDeleteAgent()
  const { close } = usePanel()
  const [confirming, setConfirming] = useState(false)
  return (
    <DropdownMenu.Root onOpenChange={(open) => !open && setConfirming(false)}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-[180px] rounded-lg border bg-popover p-1 text-[13px] text-popover-foreground shadow-md">
          <DropdownMenu.Item
            onSelect={(event) => {
              if (!confirming) {
                event.preventDefault()
                setConfirming(true)
                return
              }
              remove.mutate(name, {
                onSuccess: () => {
                  toast(`Deleted ${name}. Its messages stay.`)
                  close()
                },
              })
            }}
            className="cursor-pointer rounded-md px-2 py-1.5 text-destructive outline-none data-[highlighted]:bg-accent"
          >
            {confirming ? `Delete ${name}? Click again` : "Delete agent"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const controls = {
  running: { action: "pause", label: "Pause", primary: false, stoppable: true, hint: "Pause lets its current run finish and holds new work. Stop ends its sessions and gives back its tasks." },
  paused: { action: "resume", label: "Resume", primary: true, stoppable: true, hint: "Paused: its current run finishes, mentions and tasks wait until you resume it." },
  stopped: { action: "start", label: "Start", primary: true, stoppable: false, hint: "It ignores mentions until started." },
} as const satisfies Record<AgentDesired, { action: "start" | "pause" | "resume"; label: string; primary: boolean; stoppable: boolean; hint: string }>

function Controls({ agent }: { agent: AgentDetail & { config: AgentConfig } }) {
  const actions = { start: useStartAgent(), pause: usePauseAgent(), resume: useResumeAgent() }
  const stop = useStopAgent()
  const control = controls[agent.config.desired]
  const main = actions[control.action]
  return (
    <div className="flex items-center gap-2">
      <Button variant={control.primary ? "default" : "outline"} size="sm" onClick={() => main.mutate(agent.name)} disabled={main.isPending}>
        {control.label}
      </Button>
      {control.stoppable && (
        <Button variant="outline" size="sm" onClick={() => stop.mutate(agent.name)} disabled={stop.isPending}>
          Stop
        </Button>
      )}
      <span className="flex-1 text-xs text-faint">{control.hint}</span>
      <MoreMenu name={agent.name} />
    </div>
  )
}

function Keys({ name }: { name: string }) {
  if (!useMayManageKeys()) return null
  return (
    <>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted-foreground">Keys</span>
        <NewKeyDialog member={name} />
      </div>
      <KeyList member={name} />
    </>
  )
}

const threadName = (id: string) => (/^\d+$/.test(id) ? `#${id}` : `Thread ${id}`)

function Waiting({ name }: { name: string }) {
  const inbox = useInbox()
  const { openById } = usePanel()
  const onTasks = inbox.data?.questions.filter((t) => t.holder === name) ?? []
  const inThreads = inbox.data?.threadQuestions.filter((q) => q.who === name) ?? []
  if (!onTasks.length && !inThreads.length) return null
  return (
    <>
      <div className={sectionClass}>Waiting for a person</div>
      {onTasks.map((task) => (
        <div key={task.id} className="min-w-0">
          <span className="text-[12.5px] text-muted-foreground">
            #{task.id} · {task.title}
          </span>
          <QuestionCard task={task} />
        </div>
      ))}
      {inThreads.map((entry) => (
        <div key={entry.id} className="min-w-0">
          <span className="text-[12.5px] text-muted-foreground">
            {threadName(entry.threadId)} · #{entry.channel}
          </span>
          <ThreadQuestionCard entry={entry} onDetails={() => openById(entry.threadId)} />
        </div>
      ))}
    </>
  )
}

function RecentRun({ entry }: { entry: ActivityEntry }) {
  const { openById } = usePanel()
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => openById(entry.threadId)} className="text-[12.5px] text-muted-foreground hover:text-foreground hover:underline">
        {threadName(entry.threadId)} · #{entry.channel} · {clock(entry.at)}
      </button>
      <WorkBlock entries={[entry]} />
    </div>
  )
}

function RecentWork({ name }: { name: string }) {
  const runs = useAgentActivity(name)
  const entries = runs.data ?? []
  return (
    <>
      <div className={sectionClass}>Recent work</div>
      {entries.length ? entries.map((entry) => <RecentRun key={entry.id} entry={entry} />) : <div className="px-1 text-[13px] text-faint">No runs yet.</div>}
    </>
  )
}

const nowWords = { working: "Working on", blocked: "Blocked on", idle: "Idle" } as const satisfies Record<AgentDetail["state"], string>

function NowRow({ agent, onOpen }: { agent: AgentDetail; onOpen: (id: number) => void }) {
  const id = agent.taskId
  if (id === null) return <span className="text-muted-foreground">{nowWords[agent.state]}</span>
  return (
    <button type="button" onClick={() => onOpen(id)} className="hover:underline">
      {nowWords[agent.state]} #{id}
    </button>
  )
}

const withConfig = (agent: AgentDetail): agent is AgentDetail & { config: AgentConfig } => agent.config !== null

export function AgentProfile({ name }: { name: string }) {
  const agent = useAgent(name)
  const editable = useMayManageAgents()
  const { openTask } = usePanel()
  const current = agent.data
  return (
    <PanelFrame title={<span className="text-[13px] text-muted-foreground">Agent</span>}>
      {current && (
        <div className="grid gap-3 px-5 pt-[18px] pb-5">
          <div className="flex items-center gap-3">
            <MemberAvatar name={name} size="lg" />
            <div className="min-w-0">
              <h2 className="text-lg leading-[1.3] font-semibold tracking-[-0.01em]">{name}</h2>
              <div className="flex items-center gap-[7px] text-[13px] text-muted-foreground">
                <AgentStatusShape status={current.status} />
                <span className="truncate">{current.status === "error" ? "Error" : statusText(current.status, current.statusReason)}</span>
              </div>
            </div>
          </div>
          {current.status === "error" && current.statusReason && (
            <div role="alert" className="rounded-[10px] border border-destructive/30 px-3 py-2.5 text-[13px] text-destructive">
              {current.statusReason}
            </div>
          )}
          {withConfig(current) && editable && <Controls agent={current} />}
          <KeyValueList
            rows={
              current.config
                ? [
                    { label: "Now", value: <NowRow agent={current} onOpen={openTask} /> },
                    { label: "Owner", value: current.owner ?? "None" },
                    { label: "Machine", value: current.config.machineName },
                    { label: "Harness", value: current.config.harnessLabel ?? current.config.harness },
                    ...(editable
                      ? []
                      : [
                          { label: "Folder", value: <span className="font-mono text-xs">{current.config.folder}</span> },
                          { label: "Permissions", value: permissionLabels[current.config.permissions].label },
                        ]),
                  ]
                : [
                    { label: "Now", value: <NowRow agent={current} onOpen={openTask} /> },
                    { label: "Runs in", value: current.runsIn ?? "Connects by itself" },
                    { label: "Acts for", value: current.owner },
                  ]
            }
          />
          <Waiting name={name} />
          <RecentWork name={name} />
          {current.config && <Settings key={JSON.stringify(current.config)} name={name} config={current.config} editable={editable} />}
          <Keys name={name} />
          <div className={sectionClass}>Tasks</div>
          <div className="overflow-hidden rounded-[10px] bg-muted">
            {current.tasks.length ? current.tasks.map((task) => <TaskRow key={task.id} task={task} showChannel />) : <div className="px-3 py-[9px] text-[13px] text-faint">No tasks yet.</div>}
          </div>
        </div>
      )}
    </PanelFrame>
  )
}
