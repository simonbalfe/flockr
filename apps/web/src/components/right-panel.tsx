import { useEffect } from "react"
import { ChannelMemoryPanel } from "@/components/memory/channel-memory-panel"
import { AgentProfile } from "@/components/agents/agent-profile"
import { TaskPanel } from "@/components/task-panel"
import { ThreadPanel } from "@/components/thread-panel"
import { usePanel } from "@/lib/panel"

export function RightPanel() {
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
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-[380px] min-h-0 flex-col border-l bg-background shadow-[-12px_0_40px_rgba(0,0,0,0.18)] max-nav:max-w-none panel:static panel:z-auto panel:w-[380px] panel:shadow-none"
    >
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
