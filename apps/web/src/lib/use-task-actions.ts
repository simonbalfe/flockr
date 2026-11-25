import { toast } from "sonner"
import {
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
  const changes = useRequestChanges()
  const answer = useAnswerQuestion()

  return {
    claim: (id: number) => claim.mutate(id, { onSuccess: () => toast(`You claimed #${id}`) }),
    give: (id: number, to: string) => give.mutate({ id, to }),
    complete: (id: number) => complete.mutate(id, { onSuccess: () => toast(`Completed #${id}`) }),
    release: (id: number) => release.mutate(id, { onSuccess: () => toast(`Released #${id}`) }),
    block: (id: number, reason: string) => block.mutate({ id, reason: reason.trim() || `Blocked by ${currentUser}` }, { onSuccess: () => toast(`Blocked #${id}`) }),
    unblock: (id: number) => unblock.mutate(id, { onSuccess: () => toast(`Unblocked #${id}`) }),
    approve: (id: number) => approve.mutate(id, { onSuccess: () => toast(`Approved #${id}`) }),
    requestChanges: (task: Task) =>
      changes.mutate(task.id, { onSuccess: () => toast(`Sent #${task.id} back to ${task.holder ?? "the holder"}`) }),
    answer: (id: number, option: string) => answer.mutate({ id, option }, { onSuccess: () => toast("Answered") }),
  }
}
