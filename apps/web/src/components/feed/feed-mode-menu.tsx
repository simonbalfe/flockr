import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { feedModeLabels, feedModes, setFeedMode, useFeedMode } from "@/lib/feed-mode"

export function FeedModeMenu() {
  const mode = useFeedMode()
  const choose = (value: string) => {
    const next = feedModes.find((m) => m === value)
    if (next) setFeedMode(next)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" title="Whose messages to show">
          {feedModeLabels[mode]}
          <ChevronDown className="text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={mode} onValueChange={choose}>
          {feedModes.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              {feedModeLabels[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
