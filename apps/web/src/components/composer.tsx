import type { FileRef } from "@flockr/client"
import { Paperclip, X } from "lucide-react"
import { useRef, useState, type ChangeEvent } from "react"
import { toast } from "sonner"
import { base64Of, useUploadFile } from "@/api/attachments"
import { errorText, usePostMessage } from "@/api/hooks"
import { MessageInput } from "@/components/message-input"
import { OfflineMentionNote, useOfflineMentions } from "@/components/agents/offline-note"
import { Presence } from "@/components/presence"
import { ScheduleDialog } from "@/components/schedule-dialog"
import { Button } from "@/components/ui/button"

export function Composer({ channel, placeholder, onPosted }: { channel: string; placeholder: string; onPosted: () => void }) {
  const post = usePostMessage()
  const upload = useUploadFile()
  const offline = useOfflineMentions()
  const picker = useRef<HTMLInputElement>(null)
  const [attached, setAttached] = useState<FileRef[]>([])

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])]
    event.target.value = ""
    for (const file of chosen) {
      try {
        const ref = await upload.mutateAsync({ channel, name: file.name, contentType: file.type || "application/octet-stream", data: await base64Of(file) })
        setAttached((all) => [...all, ref])
      } catch (error) {
        toast.error(`${file.name}: ${errorText(error)}`)
      }
    }
  }

  return (
    <footer className="max-w-[904px] flex-none px-4 pt-1.5 pb-[calc(14px+env(safe-area-inset-bottom))] nav:pl-6">
      <Presence channel={channel} />
      <OfflineMentionNote names={offline.names} onClear={offline.clear} />
      {attached.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {attached.map((file) => (
            <span key={file.id} className="inline-flex items-center gap-1.5 border bg-muted px-2 py-0.5 text-[12.5px]">
              <Paperclip className="size-3" />
              {file.name}
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttached((all) => all.filter((f) => f.id !== file.id))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex items-end gap-1.5">
        <input ref={picker} type="file" multiple hidden onChange={(e) => void choose(e)} aria-label="Attach files" />
        <ScheduleDialog channel={channel} />
        <Button type="button" variant="ghost" size="icon" aria-label="Attach a file" disabled={upload.isPending} onClick={() => picker.current?.click()}>
          <Paperclip className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <MessageInput
            key={channel}
            label="Message"
            placeholder={placeholder}
            draft={{ kind: "channel", target: channel }}
            onSend={(text) =>
              post.mutate(
                { channel, text, files: attached.map((f) => f.id) },
                {
                  onSuccess: (result) => {
                    offline.notice(result.message.mentions)
                    setAttached([])
                    onPosted()
                  },
                  onError: (error) => toast.error(errorText(error)),
                },
              )
            }
          />
        </div>
      </div>
    </footer>
  )
}
