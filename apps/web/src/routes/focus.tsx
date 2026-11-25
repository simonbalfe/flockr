import { useEffect, useState } from "react"
import { threadOf, useFocus, useNeedsYou } from "@/api/focus"
import { NeedCard } from "@/components/focus/need-card"
import { LeadBox } from "@/components/focus/lead-box"
import { PlanRow } from "@/components/focus/plan-row"
import { RunRow } from "@/components/focus/run-row"
import { FocusEmpty, FocusNote, FocusSection } from "@/components/focus/section"
import { PageHeader } from "@/components/page-header"
import { TaskList } from "@/components/task-row"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePanel } from "@/lib/panel"

function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role=combobox], [role=listbox], [role=dialog]") !== null)
}

function DoneToday() {
  const focus = useFocus()
  const [open, setOpen] = useState(false)
  const done = focus.data?.doneToday ?? []
  return (
    <FocusSection
      title="Done today"
      count={done.length}
      action={
        done.length > 0 && (
          <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Hide" : "Show"}
          </Button>
        )
      }
    >
      {done.length === 0 && <FocusNote>Nothing done yet today.</FocusNote>}
      {open && done.length > 0 && <TaskList tasks={done} showChannel />}
    </FocusSection>
  )
}

export function FocusView() {
  const focus = useFocus()
  const needs = useNeedsYou()
  const { openById } = usePanel()
  const [cursor, setCursor] = useState<string | null>(null)
  const items = needs.items
  const plans = focus.data?.plans ?? []
  const running = focus.data?.running ?? []

  const next = () => {
    if (items.length === 0) return
    const at = items.findIndex((item) => item.key === cursor)
    const item = items[(at + 1) % items.length]
    if (!item) return
    setCursor(item.key)
    document.querySelector(`[data-need="${item.key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    openById(threadOf(item))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return
      event.preventDefault()
      next()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <>
      <PageHeader title="Focus">
        <Button size="sm" onClick={next} disabled={items.length === 0} aria-keyshortcuts="N">
          Next
          <kbd className="ml-1 hidden border border-current px-1 font-sans text-xs opacity-60 nav:inline">N</kbd>
        </Button>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid max-w-[720px] gap-8 px-4 pt-4 pb-8 nav:px-6">
          <FocusSection title="Needs you" count={items.length}>
            {focus.isPending && <FocusNote>Loading</FocusNote>}
            {focus.isError && <FocusNote>Could not load Focus. It retries when the board reconnects.</FocusNote>}
            {needs.loaded && items.length === 0 && <FocusEmpty title="Nothing needs you" next="Agents ask here when they are stuck." />}
            {items.length > 0 && (
              <div className="grid gap-1">
                {items.map((item) => (
                  <NeedCard key={item.key} item={item} focused={item.key === cursor} />
                ))}
              </div>
            )}
          </FocusSection>
          <FocusSection title="Plans" count={plans.length}>
            {focus.isSuccess && plans.length === 0 && <FocusNote>No plans yet. Tell lead a goal below and it makes one.</FocusNote>}
            {plans.map((plan) => (
              <PlanRow key={plan.id} plan={plan} />
            ))}
          </FocusSection>
          <FocusSection title="Running" count={running.length}>
            {focus.isSuccess && running.length === 0 && <FocusNote>No agent is working right now.</FocusNote>}
            {running.map((run) => (
              <RunRow key={`${run.agent}-${run.threadId}`} run={run} />
            ))}
          </FocusSection>
          <DoneToday />
        </div>
      </ScrollArea>
      <div className="mx-auto w-full max-w-[720px] px-4 pt-2 pb-3.5 nav:px-6">
        <LeadBox defaultChannel={plans[0]?.channel ?? null} />
      </div>
    </>
  )
}
