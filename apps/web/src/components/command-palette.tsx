import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useAgents, useBoardSearch, useChannelList, useTasks } from "@/api/hooks"
import type { SearchHit, SnippetPart } from "@/api/types"
import { Plus } from "lucide-react"
import { openNewAgent } from "@/components/agents/new-agent-store"
import { MemberAvatar } from "@/components/member-avatar"
import { usePanel } from "@/lib/panel"
import { useDebounced } from "@/lib/use-debounced"
import { StateDot } from "@/components/state-dot"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

const searchDelayMs = 200

function Snippet({ parts }: { parts: SnippetPart[] }) {
  return (
    <span className="truncate">
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="bg-transparent font-semibold text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
}

const hitKey = (hit: SearchHit) => `search ${hit.kind} ${hit.id}`

function hitPanel(hit: SearchHit): { thread?: string; task?: number } {
  switch (hit.kind) {
    case "task":
      return { task: hit.id }
    case "message":
      return hit.taskId === null ? { thread: hit.threadId } : { task: hit.taskId }
  }
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const channels = useChannelList()
  const tasks = useTasks()
  const agents = useAgents()
  const navigate = useNavigate()
  const { openAgent } = usePanel()
  const [text, setText] = useState("")
  const query = useDebounced(text.trim(), searchDelayMs)
  const found = useBoardSearch(query)
  const hits = text.trim() && query ? (found.data?.hits ?? []) : []

  const changeOpen = (next: boolean) => {
    if (!next) setText("")
    onOpenChange(next)
  }

  const pick = (go: () => Promise<void>) => {
    changeOpen(false)
    void go()
  }

  return (
    <CommandDialog open={open} onOpenChange={changeOpen} title="Search" description="Jump to a channel, task or agent, or search messages and tasks">
      <Command>
        <CommandInput placeholder="Search channels, tasks, agents and messages" value={text} onValueChange={setText} />
        <CommandList>
          <CommandEmpty>{found.isFetching ? "Searching..." : "No results"}</CommandEmpty>
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
          {hits.length > 0 && (
            <CommandGroup heading="Search messages and tasks">
              {hits.map((hit) => (
                <CommandItem
                  key={hitKey(hit)}
                  value={hitKey(hit)}
                  keywords={[text]}
                  onSelect={() => pick(() => navigate({ to: "/c/$channel", params: { channel: hit.channel }, search: hitPanel(hit) }))}
                >
                  {hit.kind === "task" ? <StateDot state={hit.state} /> : <MemberAvatar name={hit.who} size="xs" />}
                  <span className="shrink-0 font-mono text-xs text-faint">{hit.kind === "task" ? hit.id : `#${hit.channel}`}</span>
                  <Snippet parts={hit.snippet} />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
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
