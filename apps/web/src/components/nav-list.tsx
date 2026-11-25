import type { ReactNode } from "react"
import { MemberAvatar } from "@/components/member-avatar"
import { cn } from "@/lib/utils"

export function NavList({ empty, children }: { empty: string | null; children: ReactNode }) {
  return empty === null ? <ul className="grid">{children}</ul> : <div className="px-1 py-6 text-[13px] text-faint">{empty}</div>
}

interface NavRowProps {
  who: string
  place: string
  when: string
  text: string
  note?: string
  unread?: number
  onOpen: () => void
  actions?: ReactNode
}

export function NavRow({ who, place, when, text, note, unread = 0, onOpen, actions }: NavRowProps) {
  return (
    <li className="group/row relative border-b last:border-b-0">
      <button type="button" onClick={onOpen} className="grid w-full grid-cols-[30px_minmax(0,1fr)] gap-3 rounded-md px-1 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
        <MemberAvatar name={who} />
        <span className="min-w-0">
          <span className="flex items-baseline gap-[7px]">
            <span className={cn("text-[13.5px]", unread > 0 ? "font-semibold" : "font-medium")}>{who}</span>
            <span className="text-[12.5px] text-muted-foreground">{place}</span>
            <span className="text-xs text-faint">{when}</span>
            {unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground tabular-nums">{unread} new</span>}
          </span>
          <span className={cn("mt-0.5 line-clamp-2 block text-[13.5px] whitespace-pre-wrap", unread > 0 ? "text-foreground" : "text-muted-foreground")}>{text}</span>
          {note && <span className="mt-0.5 block truncate text-xs text-faint">{note}</span>}
        </span>
      </button>
      {actions && <div className="absolute top-2 right-1 flex gap-0.5">{actions}</div>}
    </li>
  )
}
