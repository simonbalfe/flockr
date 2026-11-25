import { mayChangeChannelMemory } from "@flockr/client"
import { useState } from "react"
import { useChannelMemory, useChannelMemoryActions, type MemoryState } from "@/api/memory"
import { PanelFrame } from "@/components/panel-frame"
import { MemoryList, useMe } from "./memory-list"

export function ChannelMemoryPanel({ channel }: { channel: string }) {
  const me = useMe()
  const [state, setState] = useState<MemoryState>("active")
  const items = useChannelMemory(channel, state)
  const actions = useChannelMemoryActions(channel)
  return (
    <PanelFrame title={<span className="text-[13px] text-muted-foreground">Memory of #{channel}</span>}>
      <div className="grid gap-3 px-5 pt-[18px] pb-5">
        <p className="text-[13px] text-muted-foreground">Decisions and facts every agent working in #{channel} reads first. Agents add what they learn; you can edit or archive any item.</p>
        <MemoryList
          items={items.data ?? []}
          actions={actions}
          state={state}
          onState={setState}
          canChange={(item) => (me ? mayChangeChannelMemory({ actor: me, createdBy: item.createdBy }) : false)}
          empty="Nothing remembered yet."
          placeholder="A decision or fact for this channel, such as: Primary keys are uuid"
        />
      </div>
    </PanelFrame>
  )
}
