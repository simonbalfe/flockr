import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { openNewAgent } from "./new-agent-store"

export function AgentsHeading() {
  return (
    <div className="flex items-center justify-between pr-0.5 pb-1 pl-2">
      <span className="text-[11px] font-semibold text-faint">Agents</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="New agent" onClick={openNewAgent} className="text-faint hover:text-foreground">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New agent</TooltipContent>
      </Tooltip>
    </div>
  )
}
