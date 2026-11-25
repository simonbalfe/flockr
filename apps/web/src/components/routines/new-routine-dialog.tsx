import { parseCron, routineActionKinds, routineActionLabels, routineLimits, routineTriggerKinds, routineTriggerLabels, watchableEventTypes } from "@flockr/client"
import { useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { errorText, useAgents, useChannels, useMembers } from "@/api/hooks"
import { useCreateRoutine } from "@/api/routines"
import type { RoutineAction, RoutineTrigger } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

const fieldClass = "h-8 w-full rounded-lg border bg-background px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
const anyone = ""

type TriggerKind = (typeof routineTriggerKinds)[number]
type ActionKind = (typeof routineActionKinds)[number]

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[13px] font-medium">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function NewRoutineDialog({ disabled }: { disabled: boolean }) {
  const channels = useChannels()
  const members = useMembers()
  const agents = useAgents()
  const create = useCreateRoutine()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [chosenChannel, setChosenChannel] = useState<string | null>(null)
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("cron")
  const [schedule, setSchedule] = useState("0 8 * * 1-5")
  const [eventType, setEventType] = useState<(typeof watchableEventTypes)[number]>("message.posted")
  const [actionKind, setActionKind] = useState<ActionKind>("post")
  const [text, setText] = useState("")
  const [assignee, setAssignee] = useState(anyone)
  const [agent, setAgent] = useState("")
  const [perHour, setPerHour] = useState<number>(routineLimits.perHourDefault)

  const channelList = channels.data ?? []
  const agentList = agents.data ?? []
  const channel = chosenChannel ?? channelList[0]?.id ?? ""
  const chosenAgent = agent || agentList[0]?.name || ""
  const cron = parseCron(schedule)
  const scheduleError = triggerKind === "cron" && !cron.ok ? cron.error : null
  const needsText = actionKind !== "brief"

  const trigger = (): RoutineTrigger => (triggerKind === "cron" ? { kind: "cron", schedule } : { kind: "event", eventType })
  const action = (): RoutineAction => {
    switch (actionKind) {
      case "post":
        return { kind: "post", text: text.trim() }
      case "task":
        return { kind: "task", title: text.trim(), assignee: assignee === anyone ? null : assignee }
      case "mention":
        return { kind: "mention", agent: chosenAgent, text: text.trim() }
      case "brief":
        return { kind: "brief" }
      default: {
        const never: never = actionKind
        throw new Error(`Unknown action ${String(never)}`)
      }
    }
  }

  const reset = () => {
    setName("")
    setText("")
    setChosenChannel(null)
    setAssignee(anyone)
    setAgent("")
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !channel || scheduleError || (needsText && !text.trim())) return
    create.mutate(
      { name: name.trim(), channel, trigger: trigger(), action: action(), perHour },
      {
        onSuccess: (routine) => {
          toast(`Made ${routine.name}. It is off until you turn it on.`)
          setOpen(false)
          reset()
        },
        onError: (error) => void toast(errorText(error)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          New routine
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New routine</DialogTitle>
          </DialogHeader>
          <Field label="Name">
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={routineLimits.nameMax} required autoFocus />
          </Field>
          <Field label="Channel">
            <select className={fieldClass} value={channel} onChange={(e) => setChosenChannel(e.target.value)}>
              {channelList.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="When">
            <select className={fieldClass} value={triggerKind} onChange={(e) => setTriggerKind(routineTriggerKinds.find((k) => k === e.target.value) ?? "cron")}>
              {routineTriggerKinds.map((k) => (
                <option key={k} value={k}>
                  {routineTriggerLabels[k]}
                </option>
              ))}
            </select>
          </Field>
          {triggerKind === "cron" ? (
            <Field label="Schedule" hint={scheduleError ?? "minute hour day month weekday, in UTC"}>
              <input className={`${fieldClass} font-mono`} value={schedule} onChange={(e) => setSchedule(e.target.value)} aria-invalid={scheduleError !== null} />
            </Field>
          ) : (
            <Field label="Event">
              <select className={fieldClass} value={eventType} onChange={(e) => setEventType(watchableEventTypes.find((t) => t === e.target.value) ?? "message.posted")}>
                {watchableEventTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Then">
            <select className={fieldClass} value={actionKind} onChange={(e) => setActionKind(routineActionKinds.find((k) => k === e.target.value) ?? "post")}>
              {routineActionKinds.map((k) => (
                <option key={k} value={k}>
                  {routineActionLabels[k]}
                </option>
              ))}
            </select>
          </Field>
          {actionKind === "mention" && (
            <Field label="Agent">
              <select className={fieldClass} value={chosenAgent} onChange={(e) => setAgent(e.target.value)}>
                {agentList.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {needsText && (
            <Field label={actionKind === "task" ? "Task title" : "Message"}>
              <input className={fieldClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={routineLimits.textMax} required />
            </Field>
          )}
          {actionKind === "task" && (
            <Field label="Assignee">
              <select className={fieldClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value={anyone}>Anyone</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Runs an hour, at most">
            <input
              className={fieldClass}
              type="number"
              min={1}
              max={routineLimits.perHourMax}
              value={perHour}
              onChange={(e) => setPerHour(Math.max(1, Math.min(routineLimits.perHourMax, Number(e.target.value) || 1)))}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim() || !channel || scheduleError !== null || (needsText && !text.trim()) || (actionKind === "mention" && !chosenAgent)}>
              Make routine
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
