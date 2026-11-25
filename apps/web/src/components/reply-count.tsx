import { MessageSquare } from "lucide-react"

export function ReplyCount({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-[3px] text-xs text-faint tabular-nums" aria-label={`${count} replies`}>
      <MessageSquare className="size-[13px]" />
      {count}
    </span>
  )
}
