import { ErrorBody } from "@flockr/contracts"
import { createRoute, OpenAPIHono, type RouteConfig, type z } from "@hono/zod-openapi"
import type { AccessGrant, IdentitySource } from "@flockr/contracts"
import type { Authenticator } from "../auth/identity"
import type { Viewer } from "../board/visibility"
import type { Database } from "../db/client"

export interface AppEnv {
  Variables: { db: Database; auth: Authenticator; member: string; via: IdentitySource; channels: string[] | null; viewer: Viewer; grants: AccessGrant[] | null }
}

export function router() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
        return c.json({ error: message, kind: "invalid" }, 400)
      }
      return undefined
    },
  })
}

const errorResponse = (description: string) => ({ content: { "application/json": { schema: ErrorBody } }, description })

export const errors = {
  400: errorResponse("The input is not valid"),
  401: errorResponse("Sign-in is on and the request has no session or key"),
  403: errorResponse("The acting member is not on this board, or may not do this"),
  404: errorResponse("Not found"),
  409: errorResponse("The task or message is in another state, or the claim epoch is stale"),
} as const

export const ok = <T extends z.ZodType>(schema: T, description = "OK") => ({
  200: { content: { "application/json": { schema } }, description },
  ...errors,
})

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
})

type OperationConfig = Omit<RouteConfig, "operationId" | "tags" | "summary"> & { operationId: string; tags: [string]; summary: string }

export const operation = <R extends OperationConfig>(config: R) => createRoute(config)
