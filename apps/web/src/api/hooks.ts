import { connectLive, type BoardEvent } from "@flockr/client"
import {
  addTaskCommitMutation,
  answerInThreadMutation,
  answerQuestionMutation,
  approveTaskMutation,
  blockTaskMutation,
  claimTaskMutation,
  completeTaskMutation,
  createTaskMutation,
  declareAreaMutation,
  deleteMessageMutation,
  editMessageMutation,
  getAgentOptions,
  getInboxOptions,
  getTaskOptions,
  getThreadOptions,
  giveTaskMutation,
  handOffTaskMutation,
  importChecklistMutation,
  listActivityOptions,
  listAreasOptions,
  listAgentsOptions,
  listChannelsOptions,
  listMembersOptions,
  listMessagesOptions,
  listMessageVersionsOptions,
  listTasksOptions,
  makeTaskFromThreadMutation,
  markReadMutation,
  postMessageMutation,
  releaseAreaMutation,
  releaseTaskMutation,
  replyToThreadMutation,
  stopRunMutation,
  requestChangesMutation,
  searchBoardOptions,
  unblockTaskMutation,
  updateChannelMutation,
} from "@flockr/client/react-query"
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient, type MutateOptions, type QueryClient, type UseMutationOptions } from "@tanstack/react-query"
import { useEffect } from "react"
import { agentActivityQuery, patchActivity } from "./activity-live"
import { currentUser } from "./session"

export const queries = {
  channels: () => listChannelsOptions(),
  members: () => listMembersOptions(),
  agents: () => listAgentsOptions(),
  agent: (name: string) => getAgentOptions({ path: { name } }),
  agentActivity: agentActivityQuery,
  messages: (channel: string, label?: string) => queryOptions({ ...listMessagesOptions({ path: { channel }, query: { label } }), placeholderData: keepPreviousData }),
  versions: (id: string) => listMessageVersionsOptions({ path: { id } }),
  thread: (id: string) => getThreadOptions({ path: { id } }),
  tasks: () => listTasksOptions(),
  areas: (channel: string) => listAreasOptions({ path: { channel } }),
  task: (id: number) => getTaskOptions({ path: { id } }),
  inbox: () => getInboxOptions(),
  activity: () => listActivityOptions(),
  search: (q: string) => queryOptions({ ...searchBoardOptions({ query: { q } }), placeholderData: keepPreviousData, enabled: q.trim() !== "" }),
}

export const useChannels = () => useQuery(queries.channels())
export const useMembers = () => useQuery(queries.members())
export const useAgents = () => useQuery(queries.agents())
export const useAgent = (name: string) => useQuery(queries.agent(name))
export const useAgentActivity = (name: string) => useQuery(queries.agentActivity(name))
export const useMessages = (channel: string, label?: string) => useQuery(queries.messages(channel, label))
export const useMessageVersions = (id: string, enabled: boolean) => useQuery({ ...queries.versions(id), enabled })
export const useThread = (id: string) => useQuery(queries.thread(id))
export const useTasks = () => useQuery(queries.tasks())
export const useAreas = (channel: string) => useQuery(queries.areas(channel))
export const useTask = (id: number) => useQuery(queries.task(id))
export const useInbox = () => useQuery(queries.inbox())
export const useActivity = () => useQuery(queries.activity())
export const useBoardSearch = (q: string) => useQuery(queries.search(q))

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string") return error.error
  return "Something went wrong"
}

function invalidator(client: QueryClient) {
  let pending = false
  return () => {
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      void client.invalidateQueries()
    })
  }
}

function noticeFor(event: BoardEvent): string | null {
  if (event.actor === currentUser) return null
  if (event.type === "task.asked") return `${event.actor} is waiting for you on #${event.taskId}`
  if (event.type === "question.asked") return `${event.actor} is waiting for you in a thread`
  if (event.type === "task.submitted") return `#${event.taskId} is ready for review`
  return null
}

export function useBoardSync(onNotice: (text: string) => void): void {
  const client = useQueryClient()
  useEffect(() => {
    const refresh = invalidator(client)
    const live = connectLive({
      baseUrl: window.location.origin,
      onHello: refresh,
      onActivity: refresh,
      onAgents: refresh,
      onEvent: (event) => {
        const notice = noticeFor(event)
        if (notice) onNotice(notice)
        if (patchActivity(client, event)) return
        refresh()
      },
    })
    return () => live.close()
  }, [client, onNotice])
}

function useBoardMutation<Data, Err, Vars, Args>(options: UseMutationOptions<Data, Err, Vars>, toVars: (args: Args) => Vars) {
  const client = useQueryClient()
  const mutation = useMutation({ ...options, onSuccess: () => client.invalidateQueries() })
  return { ...mutation, mutate: (args: Args, opts?: MutateOptions<Data, Err, Vars>) => mutation.mutate(toVars(args), opts) }
}

const onTask = (id: number) => ({ path: { id } })

export const usePostMessage = () =>
  useBoardMutation(postMessageMutation(), (a: { channel: string; text: string }) => ({ path: { channel: a.channel }, body: { text: a.text } }))
export const useReply = () => useBoardMutation(replyToThreadMutation(), (a: { threadId: string; text: string }) => ({ path: { id: a.threadId }, body: { text: a.text } }))
export const useStopRun = () =>
  useBoardMutation(stopRunMutation(), (a: { threadId: string; member?: string }) => ({ path: { id: a.threadId }, body: { member: a.member } }))
export const useEditMessage = () =>
  useBoardMutation(editMessageMutation(), (a: { id: string; text?: string; labels?: string[] }) => ({ path: { id: a.id }, body: { text: a.text, labels: a.labels } }))
export const useDeleteMessage = () => useBoardMutation(deleteMessageMutation(), (id: string) => ({ path: { id } }))
export const useMarkRead = () => useBoardMutation(markReadMutation(), (channel: string) => ({ path: { channel } }))
export const useMakeTaskFromThread = () => useBoardMutation(makeTaskFromThreadMutation(), (id: string) => ({ path: { id } }))
export const useClaimTask = () => useBoardMutation(claimTaskMutation(), onTask)
export const useGiveTask = () => useBoardMutation(giveTaskMutation(), (a: { id: number; to: string }) => ({ ...onTask(a.id), body: { to: a.to } }))
export const useCompleteTask = () => useBoardMutation(completeTaskMutation(), (id: number) => ({ ...onTask(id), body: {} }))
export const useReleaseTask = () => useBoardMutation(releaseTaskMutation(), (id: number) => ({ ...onTask(id), body: {} }))
export const useBlockTask = () => useBoardMutation(blockTaskMutation(), (a: { id: number; reason: string }) => ({ ...onTask(a.id), body: { reason: a.reason } }))
export const useUnblockTask = () => useBoardMutation(unblockTaskMutation(), onTask)
export const useApproveTask = () => useBoardMutation(approveTaskMutation(), onTask)
export const useRequestChanges = () => useBoardMutation(requestChangesMutation(), (id: number) => ({ ...onTask(id), body: {} }))
export const useAnswerQuestion = () => useBoardMutation(answerQuestionMutation(), (a: { id: number; option: string }) => ({ ...onTask(a.id), body: { option: a.option } }))
export const useAnswerInThread = () =>
  useBoardMutation(answerInThreadMutation(), (a: { threadId: string; option: string }) => ({ path: { id: a.threadId }, body: { option: a.option } }))
export const useCreateTask = () =>
  useBoardMutation(createTaskMutation(), (a: { channel: string; title: string; assignee: string | null }) => ({
    body: { channel: a.channel, title: a.title, assignee: a.assignee, needs: [], labels: [] },
  }))
export const useImportChecklist = () =>
  useBoardMutation(importChecklistMutation(), (a: { channel: string; markdown: string }) => ({ path: { channel: a.channel }, body: { markdown: a.markdown } }))
export const useUpdateChannel = () =>
  useBoardMutation(updateChannelMutation(), (a: { channel: string; repo: string | null }) => ({ path: { channel: a.channel }, body: { repo: a.repo } }))
export const useAddCommit = () =>
  useBoardMutation(addTaskCommitMutation(), (a: { id: number; sha: string; message?: string }) => ({ ...onTask(a.id), body: { sha: a.sha, message: a.message } }))
export const useDeclareArea = () =>
  useBoardMutation(declareAreaMutation(), (a: { channel: string; paths: string[]; note?: string; refuse?: boolean }) => ({
    path: { channel: a.channel },
    body: { paths: a.paths, note: a.note, overlap: a.refuse ? ("refuse" as const) : ("warn" as const) },
  }))
export const useReleaseArea = () => useBoardMutation(releaseAreaMutation(), (a: { channel: string; id: number }) => ({ path: { channel: a.channel, id: a.id } }))
export const useHandOffTask = () =>
  useBoardMutation(handOffTaskMutation(), (a: { id: number; to: string; note?: string; epoch: number }) => ({ ...onTask(a.id), body: { to: a.to, note: a.note, nextSteps: [], epoch: a.epoch } }))
