import { z } from "zod"
import { authConfig, authSettings, type AuthSettings } from "../../auth/settings"
import { logEmail } from "../../email/log"
import { cloudflareEmail } from "./email"

export const WorkerEnv = z.looseObject({
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
  BOARD_ROOM: z.custom<DurableObjectNamespace>((value) => typeof value === "object" && value !== null && "idFromName" in value),
  CLOUD_AGENT: z.custom<DurableObjectNamespace>((value) => typeof value === "object" && value !== null && "idFromName" in value),
  FLOCKR_CLOUD_MODEL: z.string().trim().min(1).optional(),
  EMAIL: z.custom<SendEmail>((value) => typeof value === "object" && value !== null && "send" in value).optional(),
})

export type WorkerEnv = z.infer<typeof WorkerEnv>

export function workerAuth(env: WorkerEnv, request: Request | null): AuthSettings {
  const config = authConfig(env, request ? new URL(request.url).origin : "http://localhost")
  const binding = env.EMAIL
  return authSettings(config, {
    log: () => logEmail(),
    ...(binding ? { cloudflare: () => cloudflareEmail(binding, config.emailFrom) } : {}),
  })
}
