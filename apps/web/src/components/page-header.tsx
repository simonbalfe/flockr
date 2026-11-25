import { Menu, PanelLeftOpen } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useShell } from "@/components/shell-context"
import { cn } from "@/lib/utils"

export function PageHeader({ title, topic, children }: { title: ReactNode; topic?: string; children?: ReactNode }) {
  const { openSidebar, sidebarCollapsed } = useShell()
  return (
    <header className="flex h-[52px] flex-none items-center gap-3 border-b pr-4 pl-2.5 nav:pl-6">
      <Button variant="ghost" size="icon-sm" className={cn(!sidebarCollapsed && "nav:hidden")} aria-label="Show sidebar (Cmd+B)" onClick={openSidebar}>
        {sidebarCollapsed ? <PanelLeftOpen className="max-nav:hidden" /> : null}
        <Menu className={cn(sidebarCollapsed && "nav:hidden")} />
      </Button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="text-[15px] font-semibold whitespace-nowrap">{title}</h1>
        {topic && <span className="hidden truncate text-[13px] text-muted-foreground nav:block">{topic}</span>}
      </div>
      {children}
    </header>
  )
}
