import type { ComponentProps, ReactNode } from "react"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { cn } from "@/lib/utils"

export function ChatScroll({ children }: { children: ReactNode }) {
  return (
    <Conversation initial="instant" className="min-h-0 flex-1">
      <ConversationContent className="gap-0 p-0">{children}</ConversationContent>
      <ConversationScrollButton aria-label="Scroll to the latest" className="bottom-3" />
    </Conversation>
  )
}

export function ChatItem({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 shrink-0", className)} {...props} />
}
