import { Menu } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useShell } from "@/components/shell-context"

export function PageHeader({ title, topic, children }: { title: ReactNode; topic?: string; children?: ReactNode }) {
  const { openSidebar } = useShell()
  return (
    <header className="flex h-[52px] flex-none items-center gap-3 border-b pr-4 pl-2.5 nav:pl-6">
      <Button variant="ghost" size="icon-sm" className="nav:hidden" aria-label="Show sidebar" onClick={openSidebar}>
        <Menu />
      </Button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="text-[15px] font-semibold whitespace-nowrap">{title}</h1>
        {topic && <span className="hidden truncate text-[13px] text-muted-foreground nav:block">{topic}</span>}
      </div>
      {children}
    </header>
  )
}
