import { fenceSegment, type SessionFence } from "@flockr/contracts/sessions"
import type { Claim, SessionsPort } from "./board"
import type { SessionPlace } from "./harness/types"

export const claimFence = (claim: Claim): SessionFence => ({ kind: "claim", task: claim.taskId, epoch: claim.epoch })

export function needsOpen(fence: SessionFence | null, place: SessionPlace): boolean {
  if (!fence) return true
  if (place.claim) return fenceSegment(claimFence(place.claim)) !== fenceSegment(fence)
  return fence.kind !== "session"
}

export async function openSession(board: SessionsPort, place: SessionPlace): Promise<{ fence: SessionFence; saved: number; turns: number[] }> {
  const opened = await board.open(place.session, { claim: place.claim ? { task: place.claim.taskId, epoch: place.claim.epoch } : null, thread: place.thread })
  const fence = place.claim ? claimFence(place.claim) : { kind: "session" as const, epoch: opened.epoch }
  return { fence, saved: opened.turns, turns: opened.chunks.map((c) => c.turn) }
}
