import { usePostMessage } from "@/api/hooks"
import { MessageInput } from "@/components/message-input"
import { OfflineMentionNote, useOfflineMentions } from "@/components/agents/offline-note"
import { Presence } from "@/components/presence"

export function Composer({ channel, placeholder, onPosted }: { channel: string; placeholder: string; onPosted: () => void }) {
  const post = usePostMessage()
  const offline = useOfflineMentions()
  return (
    <footer className="max-w-[904px] flex-none px-4 pt-1.5 pb-[calc(14px+env(safe-area-inset-bottom))] nav:pl-6">
      <Presence channel={channel} />
      <OfflineMentionNote names={offline.names} onClear={offline.clear} />
      <div className="mt-1.5">
        <MessageInput
          key={channel}
          label="Message"
          placeholder={placeholder}
          draft={{ kind: "channel", target: channel }}
          onSend={(text) =>
            post.mutate(
              { channel, text },
              {
                onSuccess: (result) => {
                  offline.notice(result.message.mentions)
                  onPosted()
                },
              },
            )
          }
        />
      </div>
    </footer>
  )
}
