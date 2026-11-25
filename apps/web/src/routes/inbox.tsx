import { useInbox } from "@/api/hooks"
import type { Task, ThreadQuestion } from "@/api/types"
import { MemberAvatar } from "@/components/member-avatar"
import { PageHeader } from "@/components/page-header"
import { Presence } from "@/components/presence"
import { QuestionCard, ReviewCard, ThreadQuestionCard } from "@/components/question-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePanel } from "@/lib/panel"

function InboxEntry({ who, channel, children }: { who: string; channel: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-3 py-[7px]">
      <MemberAvatar name={who} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-[7px]">
          <span className="text-[13.5px] font-semibold">{who}</span>
          <span className="text-[12.5px] text-muted-foreground">#{channel}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function Section({ title, empty, tasks, threadQuestions = [], render }: { title: string; empty: string; tasks: Task[]; threadQuestions?: ThreadQuestion[]; render: (task: Task) => React.ReactNode }) {
  const { openById } = usePanel()
  return (
    <section>
      <h2 className="mt-[18px] mb-1 text-[13px] font-semibold text-muted-foreground">{title}</h2>
      {tasks.length || threadQuestions.length ? (
        <>
          {tasks.map((task) => (
            <InboxEntry key={task.id} who={task.holder ?? "unknown"} channel={task.channel}>
              {render(task)}
            </InboxEntry>
          ))}
          {threadQuestions.map((entry) => (
            <InboxEntry key={entry.id} who={entry.who} channel={entry.channel}>
              <ThreadQuestionCard entry={entry} onDetails={() => openById(entry.threadId)} />
            </InboxEntry>
          ))}
        </>
      ) : (
        <div className="px-1 py-2 text-[13px] text-faint">{empty}</div>
      )}
    </section>
  )
}

export function InboxView() {
  const inbox = useInbox()
  return (
    <>
      <PageHeader title="Waiting for you" topic="Questions from agents and work to review" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-3 pb-6 nav:pl-6">
          <Section title="Questions" empty="No questions right now." tasks={inbox.data?.questions ?? []} threadQuestions={inbox.data?.threadQuestions ?? []} render={(task) => <QuestionCard task={task} />} />
          <Section title="To review" empty="Nothing to review." tasks={inbox.data?.reviews ?? []} render={(task) => <ReviewCard task={task} />} />
        </div>
      </ScrollArea>
      <div className="px-4 pb-3.5 nav:pl-6">
        <Presence />
      </div>
    </>
  )
}
