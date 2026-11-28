import { reactionKinds, type FileRef, type Reaction, type ReactionKind } from "@flockr/client"
import { Paperclip, SmilePlus } from "lucide-react"
import { useReact } from "@/api/attachments"
import { currentUser } from "@/api/session"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export const reactionGlyph = { "+1": "👍", "-1": "👎", eyes: "👀", check: "✅", heart: "❤️", question: "❓" } as const satisfies Record<ReactionKind, string>

export function ReactionPicker({ id, className }: { id: string; className: string }) {
  const react = useReact()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={className} aria-label="React">
          <SmilePlus className="size-[13px]" />
          React
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex gap-0.5 p-1">
        {reactionKinds.map((reaction) => (
          <DropdownMenuItem key={reaction} className="px-1.5 text-base" aria-label={reaction} onSelect={() => react.toggle({ id, reaction, on: true })}>
            {reactionGlyph[reaction]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function MessageExtras({ id, reactions, files }: { id: string; reactions: Reaction[]; files: FileRef[] }) {
  const react = useReact()
  if (!reactions.length && !files.length) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {files.map((file) => (
        <a
          key={file.id}
          href={`/api/files/${file.id}/raw`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-64 items-center gap-1.5 border bg-muted px-2 py-0.5 text-[12.5px] hover:bg-accent"
          title={`${file.name}, ${file.size} bytes`}
        >
          <Paperclip className="size-3 shrink-0" />
          <span className="truncate">{file.name}</span>
        </a>
      ))}
      {reactions.map((r) => {
        const mine = r.members.includes(currentUser)
        return (
          <button
            key={r.reaction}
            type="button"
            disabled={react.pending}
            onClick={() => react.toggle({ id, reaction: r.reaction, on: !mine })}
            aria-pressed={mine}
            title={r.members.join(", ")}
            className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 text-[12.5px] tabular-nums", mine ? "border-foreground/40 bg-accent" : "bg-background hover:bg-accent")}
          >
            <span>{reactionGlyph[r.reaction]}</span>
            {r.members.length}
          </button>
        )
      })}
    </div>
  )
}
