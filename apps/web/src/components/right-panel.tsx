import { useEffect } from "react"
import { ChannelMemoryPanel } from "@/components/memory/channel-memory-panel"
import { AgentProfile } from "@/components/agents/agent-profile"
import { TaskPanel } from "@/components/task-panel"
import { ThreadPanel } from "@/components/thread-panel"
import { PaneHandle } from "@/components/pane-handle"
import { usePanel } from "@/lib/panel"
import { resetPane, resizePane } from "@/lib/panes"

export function RightPanel({ width, onPreview, onDragging }: { width: number; onPreview: (width: number) => void; onDragging: (dragging: boolean) => void }) {
  const { search, close } = usePanel()
  const open = search.task !== undefined || search.thread !== undefined || search.agent !== undefined || search.memory !== undefined

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"]')) return
      close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!open) return null
  return (
    <aside
      aria-label="Details"
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-[var(--panel-w)] min-h-0 animate-in flex-col border-l bg-background shadow-[-12px_0_40px_rgba(0,0,0,0.18)] duration-200 slide-in-from-right max-nav:max-w-none motion-reduce:animate-none panel:relative panel:z-auto panel:w-[var(--panel-w)] panel:shadow-none"
    >
      <PaneHandle edge="left" width={width} label="Resize the panel" onPreview={onPreview} onResize={(next) => resizePane("panel", next)} onReset={() => resetPane("panel")} onDragging={onDragging} />
      {search.task !== undefined ? (
        <TaskPanel key={`task-${search.task}`} id={search.task} />
      ) : search.thread !== undefined ? (
        <ThreadPanel key={`thread-${search.thread}`} id={search.thread} />
      ) : search.agent !== undefined ? (
        <AgentProfile key={`agent-${search.agent}`} name={search.agent} />
      ) : search.memory !== undefined ? (
        <ChannelMemoryPanel key={`memory-${search.memory}`} channel={search.memory} />
      ) : null}
    </aside>
  )
}
