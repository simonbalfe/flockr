import { cancelScheduledPostMutation, listScheduledPostsOptions, schedulePostMutation } from "@flockr/client/react-query"
import { useQuery } from "@tanstack/react-query"
import { useBoardMutation } from "@/api/hooks"

export const useScheduledPosts = () => useQuery(listScheduledPostsOptions())
export const useSchedulePost = () =>
  useBoardMutation(schedulePostMutation(), (a: { channel: string; text: string; at: string }) => ({ path: { channel: a.channel }, body: { text: a.text, at: a.at } }))
export const useCancelScheduled = () => useBoardMutation(cancelScheduledPostMutation(), (a: { channel: string; id: string }) => ({ path: { channel: a.channel, id: a.id } }))
