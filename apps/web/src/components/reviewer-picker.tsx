import { toast } from "sonner"
import { errorText, useChannels, useMembers, useSetTaskReviewer } from "@/api/hooks"
import { currentUser } from "@/api/session"
import type { Channel, Member, Task } from "@/api/types"

const personValue = ""

const seesChannel = (member: Member, channel: Channel) => channel.members.includes(member.name) || (channel.visibility !== "private" && member.org === channel.org)

export function reviewerCandidates(task: Task, members: Member[], channel: Channel | undefined): Member[] {
  if (!channel) return []
  return members.filter((m) => m.name !== task.holder && (m.kind === "agent" || m.kind === "person") && seesChannel(m, channel))
}

export function ReviewerPicker({ task }: { task: Task }) {
  const members = useMembers()
  const channels = useChannels()
  const setReviewer = useSetTaskReviewer()
  const channel = channels.data?.find((c) => c.id === task.channel)
  const me = members.data?.find((m) => m.name === currentUser)
  const mayChange = task.state !== "done" && (me?.kind === "person" || task.holder === currentUser)
  if (!mayChange) return <span>{task.reviewer ?? "A person"}</span>
  const options = reviewerCandidates(task, members.data ?? [], channel)

  const change = (value: string) => {
    const reviewer = value === personValue ? null : value
    setReviewer.mutate(
      { id: task.id, reviewer },
      { onSuccess: () => toast(reviewer ? `Asked ${reviewer} to review #${task.id}` : `A person reviews #${task.id}`), onError: (error) => toast.error(errorText(error)) },
    )
  }

  return (
    <select
      className="h-7 border bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
      value={task.reviewer ?? personValue}
      onChange={(e) => change(e.target.value)}
      disabled={setReviewer.isPending}
      aria-label="Reviewer"
    >
      <option value={personValue}>A person</option>
      {options.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name}
          {m.kind === "agent" ? " (agent)" : ""}
        </option>
      ))}
    </select>
  )
}
