import { useActivity } from "@/api/hooks"
import type { Activity } from "@/api/types"
import { useNow } from "@/lib/now"

export function useLiveActivity(): Activity[] {
  const activity = useActivity()
  const now = useNow()
  return (activity.data ?? []).filter((a) => Date.parse(a.expiresAt) > now)
}
