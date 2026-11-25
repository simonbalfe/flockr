import { Ellipsis } from "lucide-react"
import { DropdownMenu } from "radix-ui"
import { useState } from "react"
import { toast } from "sonner"
import { errorText } from "@/api/hooks"
import { useDeleteRoutine, useDisableRoutine, useEnableRoutine, useMayManageRoutines, useRoutines } from "@/api/routines"
import type { Routine } from "@/api/types"
import { PageHeader } from "@/components/page-header"
import { NewRoutineDialog } from "@/components/routines/new-routine-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { useNow } from "@/lib/now"
import { actionText, jobText, relative, triggerText } from "@/lib/routine"

const shownRuns = 3

function MoreMenu({ routine, disabled }: { routine: Routine; disabled: boolean }) {
  const remove = useDeleteRoutine()
  const [confirming, setConfirming] = useState(false)
  return (
    <DropdownMenu.Root onOpenChange={(open) => !open && setConfirming(false)}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${routine.name}`} disabled={disabled}>
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
              remove.mutate(routine.id, { onSuccess: () => void toast(`Deleted ${routine.name}. Its past runs stay.`), onError: (error) => void toast(errorText(error)) })
            }}
            className="cursor-pointer rounded-md px-2 py-1.5 text-destructive outline-none data-[highlighted]:bg-accent"
          >
            {confirming ? `Delete ${routine.name}? Click again` : "Delete routine"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function RoutineRow({ routine, mayManage }: { routine: Routine; mayManage: boolean }) {
  const enable = useEnableRoutine()
  const disable = useDisableRoutine()
  const now = useNow()
  const pending = enable.isPending || disable.isPending
  const toggle = (on: boolean) => {
    const options = { onError: (error: unknown) => void toast(errorText(error)) }
    if (on) enable.mutate(routine.id, options)
    else disable.mutate(routine.id, options)
  }
  const runs = routine.recentJobs.slice(0, shownRuns)
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{routine.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          #{routine.channel} · {triggerText(routine.trigger)} · {actionText(routine.action)}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Switch checked={routine.enabled} disabled={!mayManage || pending} onCheckedChange={toggle} aria-label={routine.enabled ? `Turn ${routine.name} off` : `Turn ${routine.name} on`} />
        <MoreMenu routine={routine} disabled={!mayManage} />
      </div>
      <div className="col-span-2 grid gap-0.5 text-xs text-faint">
        {routine.enabled && routine.nextRunAt && <span>Next run {relative(routine.nextRunAt, now)}</span>}
        {runs.length ? (
          runs.map((job) => (
            <span key={job.id} className="truncate">
              {jobText(job)} · {relative(job.finishedAt ?? job.createdAt, now)}
            </span>
          ))
        ) : (
          <span>No runs yet</span>
        )}
      </div>
    </li>
  )
}

export function RoutinesView() {
  const routines = useRoutines()
  const mayManage = useMayManageRoutines()
  const list = routines.data ?? []
  return (
    <>
      <PageHeader title="Routines">
        <NewRoutineDialog disabled={!mayManage} />
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">
          {list.length ? (
            <ul className="grid gap-6 pt-2">
              {list.map((routine) => (
                <RoutineRow key={routine.id} routine={routine} mayManage={mayManage} />
              ))}
            </ul>
          ) : (
            <div className="py-2 text-sm text-faint">No routines yet. New routine makes one; it stays off until you turn it on.</div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
