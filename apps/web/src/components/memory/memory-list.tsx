import { memoryKindLabels, memoryKinds, memoryLimits, type MemoryItem, type MemoryKind } from "@flockr/client"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { errorText, useMembers } from "@/api/hooks"
import type { MemoryActions, MemoryState } from "@/api/memory"
import { currentUser } from "@/api/session"
import { Button } from "@/components/ui/button"
import { usePanel } from "@/lib/panel"
import { clock } from "@/lib/time"

const fieldClass = "w-full  border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

const fail = (error: unknown) => void toast(errorText(error))

function KindSelect({ value, onChange, label }: { value: MemoryKind; onChange: (kind: MemoryKind) => void; label: string }) {
  return (
    <select aria-label={label} className={`${fieldClass} w-auto`} value={value} onChange={(e) => onChange(memoryKinds.find((k) => k === e.target.value) ?? "fact")}>
      {memoryKinds.map((kind) => (
        <option key={kind} value={kind}>
          {memoryKindLabels[kind]}
        </option>
      ))}
    </select>
  )
}

const tagsFrom = (raw: string) => raw.split(",").map((t) => t.trim()).filter(Boolean)

function Add({ actions, placeholder }: { actions: MemoryActions; placeholder: string }) {
  const [text, setText] = useState("")
  const [kind, setKind] = useState<MemoryKind>("fact")
  const [tags, setTags] = useState("")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    actions
      .add({ text: text.trim(), kind, tags: tagsFrom(tags), sourceThread: null })
      .then(() => {
        setText("")
        setTags("")
      })
      .catch(fail)
  }
  return (
    <form onSubmit={submit} className="grid gap-2">
      <textarea className={`${fieldClass} min-h-[60px] resize-y`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={memoryLimits.textMax} aria-label="New item" />
      <div className="flex items-center gap-2">
        <KindSelect value={kind} onChange={setKind} label="Kind" />
        <input className={fieldClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" aria-label="Tags" />
        <Button type="submit" size="sm" disabled={actions.pending || !text.trim()}>
          Add
        </Button>
      </div>
    </form>
  )
}

function Row({ item, actions, canChange }: { item: MemoryItem; actions: MemoryActions; canChange: boolean }) {
  const { openById } = usePanel()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [kind, setKind] = useState(item.kind)
  const [tags, setTags] = useState(item.tags.join(", "))
  const save = () =>
    actions
      .edit(item.id, { text: text.trim(), kind, tags: tagsFrom(tags) })
      .then(() => setEditing(false))
      .catch(fail)
  if (editing) {
    return (
      <div className="grid gap-2 px-3 py-2.5 [&:not(:first-child)]:border-t">
        <textarea className={`${fieldClass} min-h-[60px] resize-y`} value={text} onChange={(e) => setText(e.target.value)} maxLength={memoryLimits.textMax} aria-label="Text" />
        <div className="flex items-center gap-2">
          <KindSelect value={kind} onChange={setKind} label="Kind" />
          <input className={fieldClass} value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={actions.pending || !text.trim()}>
            Save
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-1 px-3 py-2.5 text-[13px] [&:not(:first-child)]:border-t">
      <div className="[overflow-wrap:anywhere] whitespace-pre-wrap">{item.text}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
        <span className="font-medium text-muted-foreground">{memoryKindLabels[item.kind]}</span>
        {item.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
        {item.sourceThread && (
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => openById(item.sourceThread ?? "")}>
            from {item.sourceThread}
          </button>
        )}
        <span>
          {item.createdBy}, {clock(item.updatedAt)}
        </span>
        {canChange && (
          <span className="ml-auto flex gap-1">
            {item.archivedAt ? (
              <Button variant="ghost" size="xs" onClick={() => void actions.restore(item.id).catch(fail)}>
                Restore
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="ghost" size="xs" onClick={() => void actions.archive(item.id).catch(fail)}>
                  Archive
                </Button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

export function MemoryList({
  items,
  actions,
  state,
  onState,
  canChange,
  empty,
  placeholder,
}: {
  items: MemoryItem[]
  actions: MemoryActions
  state: MemoryState
  onState: (state: MemoryState) => void
  canChange: (item: MemoryItem) => boolean
  empty: string
  placeholder: string
}) {
  return (
    <div className="grid gap-3">
      {state === "active" && <Add actions={actions} placeholder={placeholder} />}
      <div className="flex gap-1 text-xs">
        {(["active", "archived"] as const).map((s) => (
          <Button key={s} variant={state === s ? "secondary" : "ghost"} size="xs" onClick={() => onState(s)}>
            {s === "active" ? "Active" : "Archived"}
          </Button>
        ))}
      </div>
      <div className="overflow-hidden bg-muted">
        {items.length ? items.map((item) => <Row key={item.id} item={item} actions={actions} canChange={canChange(item)} />) : <div className="px-3 py-[9px] text-[13px] text-faint">{empty}</div>}
      </div>
    </div>
  )
}

export function useMe() {
  const members = useMembers()
  return members.data?.find((m) => m.name === currentUser)
}
