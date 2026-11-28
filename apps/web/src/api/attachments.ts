import { addReactionMutation, removeReactionMutation, uploadFileMutation } from "@flockr/client/react-query"
import type { ReactionKind } from "@flockr/client"
import { useBoardMutation } from "@/api/hooks"

export const useReact = () => {
  const add = useBoardMutation(addReactionMutation(), (a: { id: string; reaction: ReactionKind }) => ({ path: { id: a.id, reaction: a.reaction } }))
  const remove = useBoardMutation(removeReactionMutation(), (a: { id: string; reaction: ReactionKind }) => ({ path: { id: a.id, reaction: a.reaction } }))
  return { toggle: (a: { id: string; reaction: ReactionKind; on: boolean }) => (a.on ? add : remove).mutate(a), pending: add.isPending || remove.isPending }
}

export const useUploadFile = () =>
  useBoardMutation(uploadFileMutation(), (a: { channel: string; name: string; contentType: string; data: string }) => ({
    path: { channel: a.channel },
    body: { name: a.name, contentType: a.contentType, data: a.data },
  }))

export async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let raw = ""
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}
