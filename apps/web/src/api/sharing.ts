import type { ChannelVisibility } from "@flockr/client"
import { addChannelMemberMutation, listChannelMembersOptions, removeChannelMemberMutation, updateChannelMutation } from "@flockr/client/react-query"
import { useQuery } from "@tanstack/react-query"
import { useBoardMutation } from "./hooks"

export const useChannelMembers = (channel: string, enabled: boolean) => useQuery({ ...listChannelMembersOptions({ path: { channel } }), enabled })

export const useSetVisibility = () =>
  useBoardMutation(updateChannelMutation(), (a: { channel: string; visibility: ChannelVisibility }) => ({ path: { channel: a.channel }, body: { visibility: a.visibility } }))

export const useAddChannelMember = () => useBoardMutation(addChannelMemberMutation(), (a: { channel: string; name: string }) => ({ path: { channel: a.channel, name: a.name } }))

export const useRemoveChannelMember = () => useBoardMutation(removeChannelMemberMutation(), (a: { channel: string; name: string }) => ({ path: { channel: a.channel, name: a.name } }))
