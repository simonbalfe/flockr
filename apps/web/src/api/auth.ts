import { mayManageKeys } from "@flockr/client"
import { createKeyMutation, listKeysOptions, requestSignInLinkMutation, revokeKeyMutation, signOutMutation, whoamiOptions, whoamiQueryKey } from "@flockr/client/react-query"
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useMembers } from "./hooks"
import { currentUser } from "./session"

export const useWhoami = () => useQuery({ ...whoamiOptions(), retry: false })

export const isSignedOut = (error: unknown): boolean => typeof error === "object" && error !== null && "kind" in error && error.kind === "unauthenticated"

export function recheckSession(client: QueryClient, error: unknown): void {
  const signedIn = client.getQueryState(whoamiQueryKey())?.status === "success"
  if (signedIn && isSignedOut(error)) void client.invalidateQueries({ queryKey: whoamiQueryKey() })
}

export const useRequestLink = () => useMutation(requestSignInLinkMutation())

export function useSignOut() {
  const client = useQueryClient()
  return useMutation({ ...signOutMutation(), onSuccess: () => client.resetQueries() })
}

export const useKeys = () => useQuery(listKeysOptions())

export function useMayManageKeys(): boolean {
  const me = useMembers().data?.find((m) => m.name === currentUser)
  return me ? mayManageKeys(me) : false
}

export function useCreateKey() {
  const client = useQueryClient()
  return useMutation({ ...createKeyMutation(), onSuccess: () => client.invalidateQueries({ queryKey: listKeysOptions().queryKey }) })
}

export function useRevokeKey() {
  const client = useQueryClient()
  return useMutation({ ...revokeKeyMutation(), onSuccess: () => client.invalidateQueries({ queryKey: listKeysOptions().queryKey }) })
}
