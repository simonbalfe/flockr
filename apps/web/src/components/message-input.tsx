import { ArrowUp } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useDrafts, useSaveDraft } from "@/api/hooks"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

const draftDelayMs = 700

export interface DraftPlace {
  kind: "channel" | "thread"
  target: string
}

function useDraft(place: DraftPlace | undefined, text: string, restore: (text: string) => void) {
  const drafts = useDrafts()
  const save = useSaveDraft()
  const kept = place ? (drafts.data?.find((d) => d.kind === place.kind && d.target === place.target)?.text ?? "") : ""
  const hydrated = useRef(place === undefined)
  const latest = useRef({ text, kept })
  latest.current = { text, kept }

  useEffect(() => {
    if (hydrated.current || !drafts.isSuccess) return
    hydrated.current = true
    if (kept !== "") restore(kept)
  }, [drafts.isSuccess])

  const flush = () => {
    if (!place || !hydrated.current) return
    const now = latest.current
    if (now.text !== now.kept) save({ ...place, text: now.text })
  }

  useEffect(() => {
    if (!place || !hydrated.current || text === kept) return
    const timer = setTimeout(flush, draftDelayMs)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => flush, [])
}

interface MessageInputProps {
  label: string
  placeholder: string
  onSend: (text: string) => void
  initial?: string
  onCancel?: () => void
  autoFocus?: boolean
  draft?: DraftPlace
}

export function MessageInput({ label, placeholder, onSend, initial = "", onCancel, autoFocus = false, draft }: MessageInputProps) {
  const [text, setText] = useState(initial)
  useDraft(draft, text, setText)
  const empty = text.trim() === ""

  const send = () => {
    if (empty) return
    onSend(text.trim())
    setText("")
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <InputGroup className="bg-background dark:bg-background">
      <InputGroupTextarea
        rows={1}
        value={text}
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-[140px] min-h-[36px] py-2 pl-3.5 text-sm"
      />
      <InputGroupAddon align="inline-end" className="self-end pb-[5px]">
        <InputGroupButton
          size="icon-xs"
          variant="default"
          aria-label="Send"
          onClick={send}
          className={cn("size-[26px] ", empty && "bg-accent text-faint hover:bg-accent")}
        >
          <ArrowUp className="size-3.5" strokeWidth={2} />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
