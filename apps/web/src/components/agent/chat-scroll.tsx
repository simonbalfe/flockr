import type { ReactNode } from "react"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"

export function ChatScroll({ children }: { children: ReactNode }) {
  return (
    <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="scroll-fade-b-0">
          <MessageScrollerContent className="gap-0">{children}</MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Scroll to the latest" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

export const ChatItem = MessageScrollerItem
