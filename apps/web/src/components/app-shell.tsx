import { Outlet } from "@tanstack/react-router"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { BoardSync } from "@/components/board-sync"
import { NewAgentDialog } from "@/components/agents/new-agent-dialog"
import { PaneHandle } from "@/components/pane-handle"
import { CommandPalette } from "@/components/command-palette"
import { RightPanel } from "@/components/right-panel"
import { ShellContext } from "@/components/shell-context"
import { SidebarContent } from "@/components/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { clampPane, resetPane, resizePane, updatePanes, usePanes } from "@/lib/panes"
import { cn } from "@/lib/utils"

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const panes = usePanes()
  const grid = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    grid.current?.style.setProperty("--sidebar-open-w", `${panes.sidebar}px`)
    grid.current?.style.setProperty("--sidebar-w", panes.sidebarOpen ? `${panes.sidebar}px` : "0px")
    grid.current?.style.setProperty("--panel-w", `${panes.panel}px`)
  }, [panes])

  const previewSidebar = (width: number) => {
    const value = `${clampPane("sidebar", width)}px`
    grid.current?.style.setProperty("--sidebar-open-w", value)
    grid.current?.style.setProperty("--sidebar-w", value)
  }
  const previewPanel = (width: number) => grid.current?.style.setProperty("--panel-w", `${clampPane("panel", width)}px`)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (key === "b" && !editing(event.target)) {
        event.preventDefault()
        updatePanes({ sidebarOpen: !panes.sidebarOpen })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panes.sidebarOpen])

  const shell = useMemo(
    () => ({
      openSidebar: () => {
        setSidebarOpen(true)
        updatePanes({ sidebarOpen: true })
      },
      toggleSidebar: () => updatePanes({ sidebarOpen: !panes.sidebarOpen }),
      sidebarCollapsed: !panes.sidebarOpen,
      openPalette: () => setPaletteOpen(true),
    }),
    [panes.sidebarOpen],
  )

  return (
    <TooltipProvider>
      <ShellContext value={shell}>
        <div
          ref={grid}
          className={cn(
            "grid h-full grid-cols-[var(--sidebar-w)_minmax(0,1fr)_auto] max-nav:grid-cols-[minmax(0,1fr)]",
            !dragging && "transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/20 nav:hidden" onClick={() => setSidebarOpen(false)} />}
          <aside
            aria-label="Sidebar"
            onClick={(event) => event.target instanceof Element && event.target.closest("a") && setSidebarOpen(false)}
            className={cn(
              "relative flex min-h-0 min-w-0 flex-col bg-sidebar max-nav:fixed max-nav:inset-y-0 max-nav:left-0 max-nav:z-30 max-nav:w-[272px] max-nav:-translate-x-full max-nav:border-r max-nav:transition-transform max-nav:duration-200 motion-reduce:transition-none",
              panes.sidebarOpen ? "nav:border-r" : "nav:invisible",
              sidebarOpen && "max-nav:translate-x-0 max-nav:shadow-[12px_0_40px_rgba(0,0,0,0.25)]",
            )}
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden nav:w-[var(--sidebar-open-w)]">
              <SidebarContent />
            </div>
            {panes.sidebarOpen && (
              <PaneHandle edge="right" width={panes.sidebar} label="Resize the sidebar" onPreview={previewSidebar} onResize={(width) => resizePane("sidebar", width)} onReset={() => resetPane("sidebar")} onDragging={setDragging} />
            )}
          </aside>
          <main className="flex min-h-0 min-w-0 flex-col">
            <Outlet />
          </main>
          <RightPanel width={panes.panel} onPreview={previewPanel} onDragging={setDragging} />
        </div>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <NewAgentDialog />
        <Toaster position="bottom-center" />
        <BoardSync />
      </ShellContext>
    </TooltipProvider>
  )
}

function editing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null)
}
