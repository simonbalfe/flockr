import { Check, Copy } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setCopied(false))
  }
  return (
    <div className="flex items-center gap-2 border bg-muted py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{command}</code>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? "Copied" : "Copy command"} onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}
