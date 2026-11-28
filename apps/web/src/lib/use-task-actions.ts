import { reviewRefusal, type ReviewAct } from "@flockr/client"
import { toast } from "sonner"
import {
  errorText,
  useChannels,
  useMembers,
  useSubmitTask,
  useAnswerQuestion,
  useApproveTask,
  useBlockTask,
  useClaimTask,
  useCompleteTask,
  useGiveTask,
  useReleaseTask,
  useRequestChanges,
  useUnblockTask,
} from "@/api/hooks"
import { currentUser } from "@/api/session"
import type { Task } from "@/api/types"

export function useTaskActions() {
  const claim = useClaimTask()
  const give = useGiveTask()
  const complete = useCompleteTask()
  const release = useReleaseTask()
  const block = useBlockTask()
  const unblock = useUnblockTask()
  const approve = useApproveTask()
  const submit = useSubmitTask()
  const changes = useRequestChanges()
  const answer = useAnswerQuestion()

  return {
    claim: (id: number) => claim.mutate(id, { onSuccess: () => toast(`You claimed #${id}`) }),
    give: (id: number, to: string) => give.mutate({ id, to }),
    complete: (id: number) => complete.mutate(id, { onSuccess: () => toast(`Completed #${id}`), onError: (error) => toast.error(errorText(error)) }),
    release: (id: number) => release.mutate(id, { onSuccess: () => toast(`Released #${id}`) }),
    block: (id: number, reason: string) => block.mutate({ id, reason: reason.trim() || `Blocked by ${currentUser}` }, { onSuccess: () => toast(`Blocked #${id}`) }),
    unblock: (id: number) => unblock.mutate(id, { onSuccess: () => toast(`Unblocked #${id}`) }),
    approve: (task: Task) =>
      approve.mutate({ id: task.id, commit: task.reviewCommit }, { onSuccess: () => toast(`Approved #${task.id}`), onError: (error) => toast.error(errorText(error)) }),
    submit: (id: number) => submit.mutate(id, { onSuccess: () => toast(`Sent #${id} for review`), onError: (error) => toast.error(errorText(error)) }),
    requestChanges: (task: Task) =>
      changes.mutate(task.id, { onSuccess: () => toast(`Sent #${task.id} back to ${task.holder ?? "the holder"}`), onError: (error) => toast.error(errorText(error)) }),
    answer: (id: number, option: string) => answer.mutate({ id, option }, { onSuccess: () => toast("Answered") }),
  }
}

export function useReviewRefusal(task: Task, act: ReviewAct): string | null {
  const members = useMembers()
  const channels = useChannels()
  const me = members.data?.find((m) => m.name === currentUser)
  const channel = channels.data?.find((c) => c.id === task.channel)
  return reviewRefusal({ actor: { name: currentUser, kind: me?.kind ?? "person" }, task, act, reviewNeedsPerson: channel?.reviewNeedsPerson ?? false })
}
