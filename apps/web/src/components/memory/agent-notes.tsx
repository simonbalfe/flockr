import { mayUseAgentNotes } from "@flockr/client"
import { useState } from "react"
import { useAgentNoteActions, useAgentNotes, type MemoryState } from "@/api/memory"
import { MemoryList, useMe } from "./memory-list"

export function AgentNotes({ name }: { name: string }) {
  const me = useMe()
  const [state, setState] = useState<MemoryState>("active")
  const notes = useAgentNotes(name, state)
  const actions = useAgentNoteActions(name)
  // An agent's notes are private to it and to people; another agent's panel shows none.
  if (!me || !mayUseAgentNotes({ actor: me, agent: name })) return null
  return (
    <>
      <div className="mt-1.5 text-[13px] font-semibold text-muted-foreground">Notes</div>
      <div className="px-1 text-xs text-faint">What {name} keeps across conversations. It reads them when a session starts; you can edit or archive any.</div>
      <MemoryList items={notes.data ?? []} actions={actions} state={state} onState={setState} canChange={() => true} empty="No notes yet." placeholder={`A short note for ${name} to remember`} />
    </>
  )
}
