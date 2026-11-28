import { createInviteMutation, listInvitesOptions, revokeInviteMutation, updateProfileMutation } from "@flockr/client/react-query"
import type { ProfileColour } from "@flockr/client"
import { useQuery } from "@tanstack/react-query"
import { useBoardMutation } from "@/api/hooks"

export const useInvites = (enabled: boolean) => useQuery({ ...listInvitesOptions(), enabled })
export const useCreateInvite = () => useBoardMutation(createInviteMutation(), (a: { email: string; name: string; org: string }) => ({ body: a }))
export const useRevokeInvite = () => useBoardMutation(revokeInviteMutation(), (id: number) => ({ path: { id } }))
export const useUpdateProfile = () =>
  useBoardMutation(updateProfileMutation(), (a: { name: string; displayName: string | null; about: string | null; colour: ProfileColour | null }) => ({
    path: { name: a.name },
    body: { displayName: a.displayName, about: a.about, colour: a.colour },
  }))
