import type { ReactNode } from "react"
import { useMembers, useTasks } from "@/api/hooks"
import type { ActivityEntry, Event, FeedItem, Member, Reply, Task, ThreadQuestion } from "@/api/types"
import { WorkBlock } from "@/components/agent/work-block"
import { MemberAvatar } from "@/components/member-avatar"
import { MessageItem } from "@/components/message-item"
import { RichText } from "@/components/rich-text"
import { splitWork } from "@/lib/work"
import { QuestionCard, ThreadQuestionCard } from "@/components/question-card"
import { TaskList } from "@/components/task-row"
import { clock } from "@/lib/time"

export type Entry = FeedItem | Reply | ThreadQuestion | ActivityEntry

export type SubThreadMap = ReadonlyMap<string, Entry[]>

interface Group {
  who: string
  at: string
  items: Exclude<Entry, Event>[]
}

type Block = { kind: "event"; event: Event } | { kind: "group"; group: Group }

function toBlocks(entries: Entry[]): Block[] {
  const blocks: Block[] = []
  let current: Group | null = null
  for (const entry of entries) {
    if (entry.kind === "event") {
      blocks.push({ kind: "event", event: entry })
      current = null
      continue
    }
    if (!current || current.who !== entry.who) {
      current = { who: entry.who, at: entry.at, items: [] }
      blocks.push({ kind: "group", group: current })
    }
    current.items.push(entry)
  }
  return blocks
}

const shownGone = (entry: Entry): boolean => (entry.kind === "text" || entry.kind === "reply") && entry.deleted

function subLabel(member: Member | undefined): string {
  if (!member) return ""
  if (member.kind === "agent") return `via ${member.owner}`
  if (member.kind === "bridge") return `from ${member.source}`
  if (member.kind === "watcher") return "watcher"
  return ""
}

function EventRow({ event }: { event: Event }) {
  return (
    <div className="py-2 text-center text-[12.5px] text-muted-foreground" data-entry={event.id}>
      {!event.system && <b className="font-medium text-foreground">{event.who} </b>}
      <RichText text={event.text} /> <span className="text-faint tabular-nums">· {clock(event.at)}</span>
    </div>
  )
}

function GroupBody({ group, inThread, tasks, subThreads }: { group: Group; inThread: boolean; tasks: Map<number, Task>; subThreads: SubThreadMap | null }) {
  const nodes: ReactNode[] = []
  let run: Task[] = []
  const flush = (key: string) => {
    if (run.length) nodes.push(<TaskList key={key} tasks={run} />)
    run = []
  }
  for (const piece of splitWork(group.items)) {
    if (piece.kind === "work") {
      flush(`run-before-${piece.id}`)
      nodes.push(<WorkBlock key={piece.id} entries={piece.entries} />)
      continue
    }
    const item = piece.item
    if (item.kind === "task") {
      const task = tasks.get(item.taskId)
      if (task) run.push(task)
      continue
    }
    flush(`run-before-${item.id}`)
    if (item.kind === "ask") {
      const task = tasks.get(item.taskId)
      if (task) nodes.push(task.question ? <QuestionCard key={item.id} task={task} /> : <TaskList key={item.id} tasks={[task]} />)
      continue
    }
    if (item.kind === "question") {
      nodes.push(<ThreadQuestionCard key={item.id} entry={item} />)
      continue
    }
    const attached = item.kind === "text" && !inThread && item.taskId !== null ? tasks.get(item.taskId) : undefined
    const subReplies = subThreads && item.kind === "reply" && item.replyTo === null ? (subThreads.get(item.id) ?? []) : null
    nodes.push(<MessageItem key={item.id} item={item} inThread={inThread} attached={attached} subReplies={subReplies} />)
  }
  flush("run-end")
  return <>{nodes}</>
}

export function Feed({ entries, inThread = false, subThreads = null }: { entries: Entry[]; inThread?: boolean; subThreads?: SubThreadMap | null }) {
  const members = useMembers()
  const taskList = useTasks()
  const tasks = new Map((taskList.data ?? []).map((t) => [t.id, t]))
  return (
    <>
      {toBlocks(entries.filter((entry) => !shownGone(entry))).map((block) => {
        if (block.kind === "event") return <EventRow key={block.event.id} event={block.event} />
        const { group } = block
        const sub = subLabel(members.data?.find((m) => m.name === group.who))
        return (
          <div key={group.items[0]?.id} data-entry={group.items[0]?.id} className={`group grid grid-cols-[30px_minmax(0,1fr)] gap-3 py-[7px] ${inThread ? "" : "hover:bg-sidebar"}`}>
            <MemberAvatar name={group.who} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-[7px]">
                <span className="text-[13.5px] font-semibold">{group.who}</span>
                {sub && <span className="text-[12.5px] text-muted-foreground">{sub}</span>}
                <span className="text-xs text-faint tabular-nums">{clock(group.at)}</span>
              </div>
              <GroupBody group={group} inThread={inThread} tasks={tasks} subThreads={subThreads} />
            </div>
          </div>
        )
      })}
    </>
  )
}
