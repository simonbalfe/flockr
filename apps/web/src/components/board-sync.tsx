import { toast } from "sonner"
import { useBoardSync } from "@/api/hooks"

const notify = (text: string) => void toast(text)

export function BoardSync() {
  useBoardSync(notify)
  return null
}
