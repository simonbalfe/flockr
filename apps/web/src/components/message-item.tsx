import { ChevronDown, ChevronRight } from "lucide-react"
import { useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { mayEditMessage, mayLabelMessage } from "@flockr/client"
import { errorText, useEditMessage, useMembers, useMessageVersions, useReply } from "@/api/hooks"
import { currentUser } from "@/api/session"
import type { Reply, Task, TextMessage } from "@/api/types"
import { Markdown } from "@/components/agent/markdown"
import { BlockList } from "@/components/block-list"
import { Feed, type Entry } from "@/components/feed"
import { MessageStatusChips } from "@/components/feed/status"
import { MemberAvatar } from "@/components/member-avatar"
import { MessageInput } from "@/components/message-input"
import { MessageToolbar } from "@/components/message-toolbar"
import { TaskList } from "@/components/task-row"
import { ThreadFooter } from "@/components/thread-footer"
import { Input } from "@/components/ui/input"
import { usePanel } from "@/lib/panel"
import { clock } from "@/lib/time"

type Mode = "read" | "edit" | "label"

const parseLabels = (raw: string) => raw.split(/[\s,]+/).map((l) => l.replace(/^\+/, "")).filter(Boolean)

function EditedMark({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const versions = useMessageVersions(id, open)
  const earlier = (versions.data?.versions ?? []).filter((v) => !v.current).reverse()
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs text-faint hover:text-foreground hover:underline">
        (edited)
      </button>
      {open && (
        <div className="order-last mt-1 grid basis-full gap-1 border-l-2 pl-3 text-[13px] text-muted-foreground">
          <div className="text-xs font-semibold text-faint">Earlier versions</div>
          {earlier.map((v) => (
            <div key={v.version}>
              <span className="mr-2 text-xs text-faint tabular-nums">
                v{v.version} · {clock(v.at)}
              </span>
              {v.text}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function LabelList({ labels, clickable }: { labels: string[]; clickable: boolean }) {
  const { filterLabel } = usePanel()
  if (!labels.length) return null
  const chip = "inline-flex h-5 items-center  border px-2 text-xs font-medium text-muted-foreground"
  return (
    <span className="inline-flex flex-wrap gap-1">
      {labels.map((label) =>
        clickable ? (
          <button key={label} type="button" onClick={() => filterLabel(label)} className={`${chip} hover:bg-muted hover:text-foreground`} title={`Show only +${label}`}>
            +{label}
          </button>
        ) : (
          <span key={label} className={chip}>
            +{label}
          </span>
        ),
      )}
    </span>
  )
}

function LabelEditor({ labels, onSave, onCancel }: { labels: string[]; onSave: (labels: string[]) => void; onCancel: () => void }) {
  const [raw, setRaw] = useState(labels.join(" "))
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") onCancel()
    if (event.key === "Enter") {
      event.preventDefault()
      onSave(parseLabels(raw))
    }
  }
  return (
    <div className="mt-1 grid gap-1">
      <Input autoFocus value={raw} aria-label="Labels" placeholder="review ui" onChange={(e) => setRaw(e.target.value)} onKeyDown={onKeyDown} className="h-7 max-w-[360px] text-[13px]" />
      <span className="text-xs text-faint">Labels separated by spaces. Enter saves, Esc cancels, empty clears.</span>
    </div>
  )
}

function SubThread({ parent, replies, open, onOpenChange }: { parent: Reply; replies: Entry[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const send = useReply()
  const last = replies[replies.length - 1]
  const participants = [...new Set(replies.map((r) => r.who))].slice(0, 3)
  if (!replies.length && !open) return null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="mt-1">
      {replies.length > 0 && (
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="-ml-1.5 inline-flex items-center gap-2 border border-transparent py-[3px] pr-2.5 pl-1.5 text-[12.5px] text-muted-foreground hover:border-border hover:bg-muted"
        >
          <Chevron className="size-3.5" />
          <span className="flex gap-0.5">
            {participants.map((name) => (
              <MemberAvatar key={name} name={name} size="xs" />
            ))}
          </span>
          <b className="font-semibold text-foreground">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </b>
          {last && <span className="text-faint tabular-nums">Last reply {clock(last.at)}</span>}
        </button>
      )}
      {open && (
        <div className="mt-1 border-l-2 pl-3">
          {replies.length > 0 && <Feed entries={replies} inThread />}
          <div className="mt-1.5">
            <MessageInput
              label={`Reply to ${parent.who}`}
              placeholder={`Reply to ${parent.who}`}
              autoFocus={!replies.length}
              onCancel={replies.length ? undefined : () => onOpenChange(false)}
              onSend={(text) => send.mutate({ threadId: parent.id, text }, { onError: (error) => toast(errorText(error)) })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function MessageItem({ item, inThread, attached, subReplies }: { item: TextMessage | Reply; inThread: boolean; attached: Task | undefined; subReplies: Entry[] | null }) {
  const members = useMembers()
  const edit = useEditMessage()
  const [mode, setMode] = useState<Mode>("read")
  const [subOpen, setSubOpen] = useState(false)
  const actor = members.data?.find((m) => m.name === currentUser)
  const author = members.data?.find((m) => m.name === item.who)
  const canEdit = actor !== undefined && mayEditMessage({ actor, author: item.who })
  const canLabel = actor !== undefined && mayLabelMessage({ actor, author: item.who, authorOwner: author?.owner ?? null })
  const replyThreadId = item.kind === "text" && !inThread && !item.thread ? item.threadId : null
  const done = { onSuccess: () => setMode("read"), onError: (error: unknown) => toast(errorText(error)) }

  return (
    <div className="group/msg relative" data-entry={item.id}>
      {item.deleted ? (
        <p className="mt-0.5 text-muted-foreground">Message deleted</p>
      ) : mode === "edit" ? (
        <div className="mt-1 grid gap-1">
          <MessageInput label="Edit message" placeholder="Edit message" initial={item.text} autoFocus onCancel={() => setMode("read")} onSend={(text) => edit.mutate({ id: item.id, text }, done)} />
          <span className="text-xs text-faint">Enter saves, Esc cancels. The earlier text stays readable.</span>
        </div>
      ) : (
        <>
          <Markdown text={item.text} className="mt-0.5" />
          <BlockList blocks={item.blocks} />
          {(item.editedAt || item.labels.length > 0) && (
            <div className="flex flex-wrap items-center gap-1">
              {item.editedAt && <EditedMark id={item.id} />}
              <LabelList labels={item.labels} clickable={!inThread} />
            </div>
          )}
          {mode === "label" && <LabelEditor labels={item.labels} onCancel={() => setMode("read")} onSave={(labels) => edit.mutate({ id: item.id, labels }, done)} />}
          {attached && <TaskList tasks={[attached]} />}
          {item.kind === "text" && !inThread && <MessageStatusChips message={item} />}
          <MessageToolbar
            id={item.id}
            who={item.who}
            replyThreadId={replyThreadId}
            actions={{
              onEdit: canEdit ? () => setMode("edit") : null,
              onLabel: canLabel ? () => setMode("label") : null,
              onReply: subReplies !== null ? () => setSubOpen(true) : null,
            }}
          />
        </>
      )}
      {item.kind === "text" && !inThread && <ThreadFooter message={item} />}
      {item.kind === "reply" && subReplies !== null && <SubThread parent={item} replies={subReplies} open={subOpen} onOpenChange={setSubOpen} />}
    </div>
  )
}
