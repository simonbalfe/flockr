import { editChannelDocumentMutation, getChannelDocumentOptions, listDocumentVersionsOptions } from "@flockr/client/react-query"
import { useQuery } from "@tanstack/react-query"
import { useBoardMutation } from "@/api/hooks"

export const useChannelDocument = (channel: string, version?: number) =>
  useQuery(getChannelDocumentOptions({ path: { channel }, query: version === undefined ? {} : { version } }))

export const useDocumentVersions = (channel: string, enabled: boolean) => useQuery({ ...listDocumentVersionsOptions({ path: { channel } }), enabled })

export const useEditDocument = () =>
  useBoardMutation(editChannelDocumentMutation(), (a: { channel: string; text: string; replaces: number; note?: string }) => ({
    path: { channel: a.channel },
    body: { text: a.text, replaces: a.replaces, note: a.note },
  }))
