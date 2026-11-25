import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useState } from "react"
import { useChannels, useDrafts, useSaveDraft, useSent } from "@/api/hooks"
import { currentUser } from "@/api/session"
import { NavList, NavRow } from "@/components/nav-list"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ago } from "@/lib/time"
import { usePanel } from "@/lib/panel"
import { placeOf } from "@/routes/threads"

function DraftList() {
  const drafts = useDrafts()
  const channels = useChannels()
  const save = useSaveDraft()
  const navigate = useNavigate()
  const { openById } = usePanel()
  const list = drafts.data ?? []
  return (
    <NavList empty={drafts.isSuccess && list.length === 0 ? "No drafts. Text you type and do not send is kept here." : null}>
      {list.map((draft) => (
        <NavRow
          key={`${draft.kind}:${draft.target}`}
          who={currentUser}
          place={`${draft.kind === "thread" ? `reply in ${draft.target}, ` : ""}${placeOf(channels.data ?? [], draft.channel)}`}
          when={ago(draft.updatedAt)}
          text={draft.text}
          onOpen={() =>
            draft.kind === "thread"
              ? openById(draft.target)
              : void navigate({ to: "/c/$channel", params: { channel: draft.target }, search: (prev) => prev })
          }
          actions={
            <Button variant="ghost" size="icon-sm" aria-label="Discard draft" onClick={() => save({ kind: draft.kind, target: draft.target, text: "" })}>
              <X />
            </Button>
          }
        />
      ))}
    </NavList>
  )
}

function SentList() {
  const sent = useSent()
  const channels = useChannels()
  const { openById } = usePanel()
  const list = sent.data ?? []
  return (
    <NavList empty={sent.isSuccess && list.length === 0 ? "You have not sent anything yet." : null}>
      {list.map((item) => (
        <NavRow
          key={item.id}
          who={currentUser}
          place={`${item.kind === "reply" ? "reply, " : ""}${placeOf(channels.data ?? [], item.channel)}`}
          when={ago(item.at)}
          text={item.text}
          onOpen={() => openById(item.threadId)}
        />
      ))}
    </NavList>
  )
}

export function DraftsView() {
  const [tab, setTab] = useState("drafts")
  return (
    <>
      <PageHeader title="Drafts & sent" topic="Unsent text follows you to any device">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">{tab === "drafts" ? <DraftList /> : <SentList />}</div>
      </ScrollArea>
    </>
  )
}
