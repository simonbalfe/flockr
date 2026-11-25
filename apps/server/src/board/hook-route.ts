import { codeHostFor } from "../code-hosts"
import type { Database } from "../db/client"
import { receiveCodeHostEvent } from "./hooks"

export const hooksPath = "/api/hooks"

export interface HookSettings {
  secret: string
}

export function hookSettingsFrom(env: Record<string, unknown>): HookSettings | null {
  const secret = env.FLOCKR_HOOK_SECRET
  return typeof secret === "string" && secret.length >= 16 ? { secret } : null
}

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status })

export async function receiveHook(db: Database, request: Request, hostName: string, settings: HookSettings | null): Promise<Response> {
  const host = codeHostFor(hostName)
  if (!settings || !host) return answer(404, { error: settings ? `No code host ${hostName}` : "Webhooks are off on this board (FLOCKR_HOOK_SECRET)", kind: "not_found" })
  const body = await request.text()
  if (!(await host.verify(request.headers, body, settings.secret))) return answer(401, { error: "The delivery's signature does not match FLOCKR_HOOK_SECRET", kind: "unauthenticated" })
  const delivery = host.deliveryId(request.headers)
  if (!delivery) return answer(400, { error: "The delivery has no id", kind: "invalid" })
  let event
  try {
    event = host.parse(request.headers, body)
  } catch {
    return answer(400, { error: "The delivery's body is not what this host sends", kind: "invalid" })
  }
  if (!event) return answer(202, { outcome: "ignored", reason: "Not an event a thread shows" })
  const result = await receiveCodeHostEvent(db, host, delivery, event)
  return answer(result.outcome === "posted" ? 200 : 202, result)
}
