import { mayManageRoutine, type CreateRoutineBody } from "@flockr/client"
import { createRoutineMutation, deleteRoutineMutation, disableRoutineMutation, enableRoutineMutation, listRoutinesOptions } from "@flockr/client/react-query"
import { useMutation, useQuery, useQueryClient, type MutateOptions, type UseMutationOptions } from "@tanstack/react-query"
import { useMembers } from "./hooks"
import { currentUser } from "./session"

export const routineQueries = { routines: () => listRoutinesOptions() }

export const useRoutines = () => useQuery(routineQueries.routines())

export function useMayManageRoutines(): boolean {
  const me = useMembers().data?.find((m) => m.name === currentUser)
  return me ? mayManageRoutine(me) : false
}

function useRoutineMutation<Data, Err, Vars, Args>(options: UseMutationOptions<Data, Err, Vars>, toVars: (args: Args) => Vars) {
  const client = useQueryClient()
  const mutation = useMutation({ ...options, onSuccess: () => client.invalidateQueries() })
  return { ...mutation, mutate: (args: Args, opts?: MutateOptions<Data, Err, Vars>) => mutation.mutate(toVars(args), opts) }
}

const byId = (id: number) => ({ path: { id } })

export const useCreateRoutine = () => useRoutineMutation(createRoutineMutation(), (body: CreateRoutineBody) => ({ body }))
export const useEnableRoutine = () => useRoutineMutation(enableRoutineMutation(), byId)
export const useDisableRoutine = () => useRoutineMutation(disableRoutineMutation(), byId)
export const useDeleteRoutine = () => useRoutineMutation(deleteRoutineMutation(), byId)
