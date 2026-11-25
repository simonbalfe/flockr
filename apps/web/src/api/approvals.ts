import { mayManageApprovalRules, type ActionKind, type SetApprovalRuleBody } from "@flockr/client"
import { clearApprovalRuleMutation, listApprovalRulesOptions, setApprovalRuleMutation } from "@flockr/client/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMembers } from "./hooks"
import { currentUser } from "./session"

export const approvalQueries = { rules: () => listApprovalRulesOptions() }

export const useApprovalRules = () => useQuery(approvalQueries.rules())

export function useMayManageApprovalRules(): boolean {
  const me = useMembers().data?.find((m) => m.name === currentUser)
  return me ? mayManageApprovalRules(me) : false
}

export function useSetApprovalRule() {
  const client = useQueryClient()
  const mutation = useMutation({ ...setApprovalRuleMutation(), onSuccess: () => client.invalidateQueries({ queryKey: approvalQueries.rules().queryKey }) })
  return { ...mutation, mutate: (body: SetApprovalRuleBody, options?: { onError?: (error: unknown) => void }) => mutation.mutate({ body }, options) }
}

export function useClearApprovalRule() {
  const client = useQueryClient()
  const mutation = useMutation({ ...clearApprovalRuleMutation(), onSuccess: () => client.invalidateQueries({ queryKey: approvalQueries.rules().queryKey }) })
  return {
    ...mutation,
    mutate: (scope: { kind: ActionKind; channel: string | null }, options?: { onError?: (error: unknown) => void }) =>
      mutation.mutate({ query: { kind: scope.kind, channel: scope.channel ?? undefined } }, options),
  }
}
