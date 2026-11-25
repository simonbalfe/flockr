import { useNavigate } from "@tanstack/react-router"
import { useAgents, useChannels, useTasks } from "@/api/hooks"
import { Plus } from "lucide-react"
import { openNewAgent } from "@/components/agents/new-agent-store"
import { MemberAvatar } from "@/components/member-avatar"
import { usePanel } from "@/lib/panel"
import { StateDot } from "@/components/state-dot"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const channels = useChannels()
  const tasks = useTasks()
  const agents = useAgents()
  const navigate = useNavigate()
  const { openAgent } = usePanel()

  const pick = (go: () => Promise<void>) => {
    onOpenChange(false)
    void go()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to a channel, task or agent">
      <Command>
        <CommandInput placeholder="Search channels, tasks and agents" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Channels">
            {(channels.data ?? []).map((channel) => (
              <CommandItem
                key={channel.id}
                value={`channel ${channel.id}`}
                onSelect={() => pick(() => navigate({ to: "/c/$channel", params: { channel: channel.id }, search: (prev) => prev }))}
              >
                <span className="w-[18px] text-center font-medium text-faint">#</span>
                {channel.id}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Tasks">
            {(tasks.data ?? []).map((task) => (
              <CommandItem
                key={task.id}
                value={`task ${task.id} ${task.title}`}
                onSelect={() => pick(() => navigate({ to: "/c/$channel", params: { channel: task.channel }, search: { task: task.id } }))}
              >
                <StateDot state={task.state} />
                <span className="font-mono text-xs text-faint">{task.id}</span>
                <span className="truncate">{task.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem value="action new agent create bot" onSelect={() => pick(async () => openNewAgent())}>
              <Plus className="size-4 text-faint" />
              New agent
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Agents">
            {(agents.data ?? []).map((agent) => (
              <CommandItem key={agent.name} value={`agent ${agent.name}`} onSelect={() => pick(async () => openAgent(agent.name))}>
                <MemberAvatar name={agent.name} size="xs" />
                {agent.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
