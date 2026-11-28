import type { ChatBridgeName } from "@flockr/client"
import { linkBridgeChannelMutation, linkBridgePersonMutation, listBridgesOptions, unlinkBridgeChannelMutation, unlinkBridgePersonMutation } from "@flockr/client/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export const bridgeQueries = { list: () => listBridgesOptions() }

export const useBridges = () => useQuery(bridgeQueries.list())

type Done = { onError?: (error: unknown) => void; onSuccess?: () => void }

function useRefreshing<T>(options: T) {
  const client = useQueryClient()
  return { ...options, onSuccess: () => client.invalidateQueries({ queryKey: bridgeQueries.list().queryKey }) }
}

export function useLinkBridgeChannel() {
  const mutation = useMutation(useRefreshing(linkBridgeChannelMutation()))
  return { ...mutation, mutate: (link: { bridge: ChatBridgeName; channel: string; external: string }, done?: Done) => mutation.mutate({ path: { bridge: link.bridge, channel: link.channel }, body: { external: link.external } }, done) }
}

export function useUnlinkBridgeChannel() {
  const mutation = useMutation(useRefreshing(unlinkBridgeChannelMutation()))
  return { ...mutation, mutate: (link: { bridge: ChatBridgeName; channel: string }, done?: Done) => mutation.mutate({ path: link }, done) }
}

export function useLinkBridgePerson() {
  const mutation = useMutation(useRefreshing(linkBridgePersonMutation()))
  return { ...mutation, mutate: (link: { bridge: ChatBridgeName; external: string }, done?: Done) => mutation.mutate({ path: { bridge: link.bridge }, body: { external: link.external } }, done) }
}

export function useUnlinkBridgePerson() {
  const mutation = useMutation(useRefreshing(unlinkBridgePersonMutation()))
  return { ...mutation, mutate: (bridge: ChatBridgeName, done?: Done) => mutation.mutate({ path: { bridge } }, done) }
}
