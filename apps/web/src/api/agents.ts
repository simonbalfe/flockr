import type { AgentPermissions, CreateAgentBody } from "@flockr/client"
import {
  createAgentMutation,
  deleteAgentMutation,
  listMachinesOptions,
  pauseAgentMutation,
  resumeAgentMutation,
  startAgentMutation,
  stopAgentMutation,
  updateAgentMutation,
} from "@flockr/client/react-query"
import { useMutation, useQuery, useQueryClient, type MutateOptions, type UseMutationOptions } from "@tanstack/react-query"

export const machineQueries = { machines: () => listMachinesOptions() }

export const useMachines = (options: { fresh?: boolean } = {}) => useQuery({ ...machineQueries.machines(), refetchOnMount: options.fresh ? "always" : true })

function useAgentMutation<Data, Err, Vars, Args>(options: UseMutationOptions<Data, Err, Vars>, toVars: (args: Args) => Vars) {
  const client = useQueryClient()
  const mutation = useMutation({ ...options, onSuccess: () => client.invalidateQueries() })
  return { ...mutation, mutate: (args: Args, opts?: MutateOptions<Data, Err, Vars>) => mutation.mutate(toVars(args), opts) }
}

const byName = (name: string) => ({ path: { name } })

export const useCreateAgent = () => useAgentMutation(createAgentMutation(), (body: CreateAgentBody) => ({ body }))
export const useUpdateAgent = () =>
  useAgentMutation(updateAgentMutation(), (a: { name: string; folder?: string; permissions?: AgentPermissions; personality?: string | null }) => ({
    ...byName(a.name),
    body: { folder: a.folder, permissions: a.permissions, personality: a.personality },
  }))
export const useStartAgent = () => useAgentMutation(startAgentMutation(), byName)
export const useStopAgent = () => useAgentMutation(stopAgentMutation(), byName)
export const usePauseAgent = () => useAgentMutation(pauseAgentMutation(), byName)
export const useResumeAgent = () => useAgentMutation(resumeAgentMutation(), byName)
export const useDeleteAgent = () => useAgentMutation(deleteAgentMutation(), byName)
