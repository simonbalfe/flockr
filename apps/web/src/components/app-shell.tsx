import { Outlet } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { BoardSync } from "@/components/board-sync"
import { NewAgentDialog } from "@/components/agents/new-agent-dialog"
import { CommandPalette } from "@/components/command-palette"
import { RightPanel } from "@/components/right-panel"
import { ShellContext } from "@/components/shell-context"
import { SidebarContent } from "@/components/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const shell = useMemo(() => ({ openSidebar: () => setSidebarOpen(true), openPalette: () => setPaletteOpen(true) }), [])

  return (
    <TooltipProvider>
      <ShellContext value={shell}>
        <div className="grid h-full grid-cols-[232px_minmax(0,1fr)_auto] max-nav:grid-cols-[minmax(0,1fr)]">
          {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/20 nav:hidden" onClick={() => setSidebarOpen(false)} />}
          <aside
            aria-label="Sidebar"
            onClick={(event) => event.target instanceof Element && event.target.closest("a") && setSidebarOpen(false)}
            className={cn(
              "flex min-h-0 flex-col border-r bg-sidebar max-nav:fixed max-nav:inset-y-0 max-nav:left-0 max-nav:z-30 max-nav:w-[272px] max-nav:-translate-x-full max-nav:transition-transform max-nav:duration-200 motion-reduce:transition-none",
              sidebarOpen && "max-nav:translate-x-0 max-nav:shadow-[12px_0_40px_rgba(0,0,0,0.25)]",
            )}
          >
            <SidebarContent />
          </aside>
          <main className="flex min-h-0 min-w-0 flex-col">
            <Outlet />
          </main>
          <RightPanel />
        </div>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <NewAgentDialog />
        <Toaster position="bottom-center" />
        <BoardSync />
      </ShellContext>
    </TooltipProvider>
  )
}
