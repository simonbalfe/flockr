import { useState } from "react"
import { toast } from "sonner"
import { useChannelDocument, useDocumentVersions, useEditDocument } from "@/api/documents"
import { errorText } from "@/api/hooks"
import { RichText } from "@/components/rich-text"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ago } from "@/lib/time"

const fieldClass = "h-8 border bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"

export function ChannelDocumentDialog({ channel }: { channel: string }) {
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<number | undefined>(undefined)
  const [draft, setDraft] = useState<{ text: string; note: string; replaces: number } | null>(null)
  const [moved, setMoved] = useState<string | null>(null)
  const current = useChannelDocument(channel)
  const shown = useChannelDocument(channel, viewing)
  const versions = useDocumentVersions(channel, open)
  const edit = useEditDocument()
  const doc = viewing === undefined ? current.data : shown.data
  const head = current.data

  const startEdit = () => {
    if (!head) return
    setViewing(undefined)
    setMoved(null)
    setDraft({ text: head.text, note: "", replaces: head.version })
  }

  const save = () => {
    if (!draft) return
    edit.mutate(
      { channel, text: draft.text, replaces: draft.replaces, note: draft.note.trim() || undefined },
      {
        onSuccess: (saved) => {
          toast(`#${channel} document is at version ${saved.version}`)
          setDraft(null)
          setMoved(null)
        },
        onError: (error) => setMoved(errorText(error)),
      },
    )
  }

  const rebase = () => {
    if (!draft || !head) return
    setDraft({ ...draft, replaces: head.version })
    setMoved(null)
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setDraft(null)
      setViewing(undefined)
      setMoved(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Doc{head && head.version > 0 ? <span className="ml-1 text-faint tabular-nums">v{head.version}</span> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>#{channel} document</DialogTitle>
          <DialogDescription>
            {doc && doc.version > 0
              ? `Version ${doc.version}${doc.current ? "" : " (earlier)"} by ${doc.editedBy ?? "someone"}${doc.editedAt ? `, ${ago(doc.editedAt)}` : ""}${doc.note ? `: ${doc.note}` : ""}`
              : "The channel's current plan and shared notes. Every member and agent reads it first."}
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-3">
            {moved && (
              <div className="grid gap-2 bg-muted px-3 py-2.5 text-[13px]">
                <span>{moved}</span>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Read version {head?.version ?? "?"} by {head?.editedBy ?? "someone"}; your text is kept below</summary>
                  <div className="mt-2 max-h-48 overflow-y-auto">{head?.text ? <RichText text={head.text} /> : null}</div>
                </details>
                <div>
                  <Button size="sm" variant="secondary" onClick={rebase}>
                    Save over version {head?.version ?? "?"}
                  </Button>
                </div>
              </div>
            )}
            <Textarea className="min-h-72 font-mono text-[13px]" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} aria-label="Document" />
            <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="What changed, in a few words" aria-label="Note" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={edit.isPending || moved !== null}>
                Save as version {draft.replaces + 1}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="max-h-[60vh] overflow-y-auto text-sm">{doc && doc.text ? <RichText text={doc.text} /> : <p className="text-muted-foreground">Nothing written yet.</p>}</div>
            <DialogFooter className="items-center">
              {(versions.data?.length ?? 0) > 1 && (
                <select className={fieldClass} value={viewing ?? ""} onChange={(e) => setViewing(e.target.value ? Number(e.target.value) : undefined)} aria-label="Version">
                  <option value="">Current version</option>
                  {(versions.data ?? []).slice(1).map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} by {v.editedBy}
                      {v.note ? `: ${v.note}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <Button onClick={startEdit} disabled={!head}>
                {head && head.version > 0 ? "Edit" : "Write it"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
