import { ArrowUp } from "lucide-react"
import { useState, type KeyboardEvent } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

export function MessageInput({ label, placeholder, onSend }: { label: string; placeholder: string; onSend: (text: string) => void }) {
  const [text, setText] = useState("")
  const empty = text.trim() === ""

  const send = () => {
    if (empty) return
    onSend(text.trim())
    setText("")
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <InputGroup className="rounded-[10px] bg-background dark:bg-background">
      <InputGroupTextarea
        rows={1}
        value={text}
        aria-label={label}
        placeholder={placeholder}
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
          className={cn("size-[26px] rounded-full", empty && "bg-accent text-faint hover:bg-accent")}
        >
          <ArrowUp className="size-3.5" strokeWidth={2} />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
