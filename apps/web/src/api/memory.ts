import type { AddMemoryBody, MemoryItem, UpdateMemoryBody } from "@flockr/client"
import {
  addAgentNoteMutation,
  addChannelMemoryMutation,
  archiveAgentNoteMutation,
  archiveChannelMemoryMutation,
  listAgentNotesOptions,
  listChannelMemoryOptions,
  restoreAgentNoteMutation,
  restoreChannelMemoryMutation,
  updateAgentNoteMutation,
  updateChannelMemoryMutation,
} from "@flockr/client/react-query"
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from "@tanstack/react-query"

export type MemoryState = "active" | "archived"

// What the shared list component needs from either kind of memory.
export interface MemoryActions {
  add: (body: AddMemoryBody) => Promise<MemoryItem>
  edit: (id: number, body: UpdateMemoryBody) => Promise<MemoryItem>
  archive: (id: number) => Promise<MemoryItem>
  restore: (id: number) => Promise<MemoryItem>
  pending: boolean
}

function useRefreshing<Data, Err, Vars>(options: UseMutationOptions<Data, Err, Vars>) {
  const client = useQueryClient()
  return useMutation({ ...options, onSuccess: () => client.invalidateQueries() })
}

export const useAgentNotes = (name: string, state: MemoryState) => useQuery(listAgentNotesOptions({ path: { name }, query: { state } }))
export const useChannelMemory = (channel: string, state: MemoryState) => useQuery(listChannelMemoryOptions({ path: { channel }, query: { state } }))

export function useAgentNoteActions(name: string): MemoryActions {
  const add = useRefreshing(addAgentNoteMutation())
  const edit = useRefreshing(updateAgentNoteMutation())
  const archive = useRefreshing(archiveAgentNoteMutation())
  const restore = useRefreshing(restoreAgentNoteMutation())
  return {
    add: (body) => add.mutateAsync({ path: { name }, body }),
    edit: (id, body) => edit.mutateAsync({ path: { name, id }, body }),
    archive: (id) => archive.mutateAsync({ path: { name, id } }),
    restore: (id) => restore.mutateAsync({ path: { name, id } }),
    pending: add.isPending || edit.isPending || archive.isPending || restore.isPending,
  }
}

export function useChannelMemoryActions(channel: string): MemoryActions {
  const add = useRefreshing(addChannelMemoryMutation())
  const edit = useRefreshing(updateChannelMemoryMutation())
  const archive = useRefreshing(archiveChannelMemoryMutation())
  const restore = useRefreshing(restoreChannelMemoryMutation())
  return {
    add: (body) => add.mutateAsync({ path: { channel }, body }),
    edit: (id, body) => edit.mutateAsync({ path: { channel, id }, body }),
    archive: (id) => archive.mutateAsync({ path: { channel, id } }),
    restore: (id) => restore.mutateAsync({ path: { channel, id } }),
    pending: add.isPending || edit.isPending || archive.isPending || restore.isPending,
  }
}
