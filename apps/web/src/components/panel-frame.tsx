import { X } from "lucide-react"
import type { ReactNode } from "react"
import { ChatScroll } from "@/components/agent/chat-scroll"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePanel } from "@/lib/panel"

export function PanelFrame({ title, children, footer, chat = false }: { title: ReactNode; children: ReactNode; footer?: ReactNode; chat?: boolean }) {
  const { close } = usePanel()
  return (
    <>
      <div className="flex h-[52px] flex-none items-center gap-2 border-b pr-2.5 pl-5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">{title}</div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      {chat ? <ChatScroll>{children}</ChatScroll> : <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>}
      {footer}
    </>
  )
}

export function KeyValueList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <div className="overflow-hidden rounded-[10px] bg-muted">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-[9px] text-[13px] [&:not(:first-child)]:border-t">
          <span className="flex-none text-muted-foreground">{row.label}</span>
          <span className="inline-flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-right [overflow-wrap:anywhere]">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

export function PanelHeading({ children }: { children: ReactNode }) {
  return <div className="mt-[18px] mb-1 px-5 text-[13px] font-semibold text-muted-foreground">{children}</div>
}
