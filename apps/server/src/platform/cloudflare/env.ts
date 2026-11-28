import { z } from "zod"
import { authConfig, authSettings, type AuthSettings } from "../../auth/settings"
import { logEmail } from "../../email/log"
import { cloudflareEmail } from "./email"
import type { SandboxBox, SandboxIndex } from "./sandbox-box"

const isNamespace = (value: unknown) => typeof value === "object" && value !== null && "idFromName" in value

export const SandboxEnv = z.looseObject({
  SANDBOX: z.custom<DurableObjectNamespace<SandboxBox>>(isNamespace).optional(),
  SANDBOX_INDEX: z.custom<DurableObjectNamespace<SandboxIndex>>(isNamespace).optional(),
})

export const WorkerEnv = z.looseObject({
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
  BOARD_ROOM: z.custom<DurableObjectNamespace>(isNamespace),
  CLOUD_AGENT: z.custom<DurableObjectNamespace>(isNamespace),
  FLOCKR_CLOUD_MODEL: z.string().trim().min(1).optional(),
  EMAIL: z.custom<SendEmail>((value) => typeof value === "object" && value !== null && "send" in value).optional(),
  ...SandboxEnv.shape,
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
