import { authBasePath, defaultMember, memberHeader } from "@flockr/contracts"
import { swaggerUI } from "@hono/swagger-ui"
import type { MiddlewareHandler } from "hono"
import { createAuthenticator, headerIdentity, isPublicApiPath, signInNeeded } from "./auth/identity"
import { requireDirectAccess, requireInScope } from "./auth/scope"
import { authOff, type AuthSettings } from "./auth/settings"
import { BoardError, notFound, unauthenticated } from "./board/errors"
import { hooksPath, receiveHook, type HookSettings } from "./board/hook-route"
import type { Database } from "./db/client"
import { mcpHandler } from "./mcp/server"
import { modelProxyPath, proxyModel, type ModelProxySettings } from "./model-proxy/proxy"
import { activityRoutes } from "./routes/activity"
import { activityEntryRoutes } from "./routes/activity-entries"
import { agentRoutes } from "./routes/agents"
import { approvalRoutes } from "./routes/approvals"
import { areaRoutes } from "./routes/areas"
import { authRoutes } from "./routes/auth"
import { channelRoutes } from "./routes/channels"
import { checklistRoutes } from "./routes/checklist"
import { claimRoutes } from "./routes/claims"
import { eventRoutes } from "./routes/events"
import { flowRoutes } from "./routes/flow"
import { keyRoutes } from "./routes/keys"
import { machineRoutes } from "./routes/machines"
import { memberRoutes } from "./routes/members"
import { memoryRoutes } from "./routes/memory"
import { messageRoutes } from "./routes/messages"
import { navigationRoutes } from "./routes/navigation"
import { questionRoutes } from "./routes/questions"
import { reviewRoutes } from "./routes/review"
import { routineRoutes } from "./routes/routines"
import { searchRoutes } from "./routes/search"
import { router, type AppEnv } from "./routes/shared"
import { taskRoutes } from "./routes/tasks"
import { threadRoutes } from "./routes/threads"

const info = {
  title: "Flockr",
  version: "0.1.0",
  description: `A shared board for people and agents: channels, threads and tasks with claims and leases. With sign-in off (the default) the acting member is the ${memberHeader} header (default ${defaultMember}). With sign-in on, every request needs a session cookie (${authBasePath}) or a key sent as Authorization: Bearer <key>; the header then only picks an agent the signed-in person owns.`,
}

export interface AppOptions {
  auth?: AuthSettings
  // Lets sandboxes reach the model without holding its key (PL8); off when null.
  modelProxy?: ModelProxySettings | null
  // Code host webhooks into task threads (5e); off when null.
  hooks?: HookSettings | null
}

export function createApp(db: Database, options: AppOptions = {}) {
  const app = router()
  const authenticator = createAuthenticator(db, options.auth ?? authOff)

  const identify: MiddlewareHandler<AppEnv> = async (c, next) => {
    // A box proves itself with its box token, checked by the proxy, not as a member.
    if (c.req.path.startsWith(`${modelProxyPath}/`)) return next()
    // A code host proves itself by signing the delivery, checked by the hook route.
    if (c.req.path.startsWith(`${hooksPath}/`)) return next()
    c.set("db", db)
    c.set("auth", authenticator)
    const open = authenticator.mode === "off" || isPublicApiPath(c.req.path)
    const identity = open ? headerIdentity(c.req.raw.headers) : await authenticator.identify(c.req.raw.headers)
    if (!identity) throw unauthenticated(signInNeeded)
    c.set("member", identity.member)
    c.set("via", identity.via)
    c.set("channels", identity.channels)
    const request = c.req.raw
    const scoped = { method: request.method, pathname: c.req.path, query: new URL(request.url).searchParams, body: () => request.clone().json().catch(() => null) }
    await requireInScope(db, identity.channels, scoped)
    await requireDirectAccess(db, identity.member, scoped)
    await next()
  }

  app.use("/api/*", identify)
  app.use("/mcp", identify)

  app.onError((error, c) => {
    if (error instanceof BoardError) return c.json({ error: error.message, kind: error.kind }, error.status)
    console.error(error)
    return c.json({ error: "Internal error; the server log has the details", kind: "internal" }, 500)
  })

  const api = app
    .route("/", channelRoutes)
    .route("/", messageRoutes)
    .route("/", threadRoutes)
    .route("/", memberRoutes)
    .route("/", claimRoutes)
    .route("/", taskRoutes)
    .route("/", areaRoutes)
    .route("/", checklistRoutes)
    .route("/", flowRoutes)
    .route("/", reviewRoutes)
    .route("/", questionRoutes)
    .route("/", eventRoutes)
    .route("/", activityRoutes)
    .route("/", activityEntryRoutes)
    .route("/", agentRoutes)
    .route("/", memoryRoutes)
    .route("/", machineRoutes)
    .route("/", searchRoutes)
    .route("/", routineRoutes)
    .route("/", approvalRoutes)
    .route("/", keyRoutes)
    .route("/", navigationRoutes)
    .route("/", authRoutes)

  const document = () => api.getOpenAPI31Document({ openapi: "3.1.0", info })

  // Not an OpenAPI operation: it is for sandboxes, not for people or agents on the board.
  api.all(`${modelProxyPath}/*`, (c) => proxyModel(c.req.raw, options.modelProxy ?? null, new Date()))
  api.post(`${hooksPath}/:host`, (c) => receiveHook(db, c.req.raw, c.req.param("host"), options.hooks ?? null))
  api.get("/api/openapi.json", (c) => c.json(document()))
  api.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }))
  api.on(["GET", "POST"], `${authBasePath}/*`, (c) => {
    if (authenticator.mode === "off") throw notFound("Sign-in is off on this board (FLOCKR_AUTH=off)")
    return authenticator.betterAuth().handler(c.req.raw)
  })
  api.notFound((c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}; see /api/openapi.json`, kind: "not_found" }, 404))

  const mcp = mcpHandler({ document, dispatch: (url, init) => Promise.resolve(api.request(url, init)), defaultMember })
  api.all("/mcp", (c) => mcp(c.req.raw))

  return Object.assign(api, { document, authenticator })
}

export type FlockrApp = ReturnType<typeof createApp>
