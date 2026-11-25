import type { ReactNode } from "react"

export function FocusSection({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex h-7 items-center gap-2 px-1">
        <h2 className="text-xs font-semibold text-muted-foreground">{title}</h2>
        {count !== undefined && count > 0 && <span className="text-xs text-faint tabular-nums">{count}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

export function FocusEmpty({ title, next }: { title: string; next: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-6 text-center text-sm">
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-muted-foreground">{next}</div>
    </div>
  )
}

export function FocusNote({ children }: { children: ReactNode }) {
  return <div className="px-1 py-2 text-sm text-faint">{children}</div>
}
