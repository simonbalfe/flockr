import { authBasePath, defaultMember, memberHeader } from "@flockr/contracts"
import { swaggerUI } from "@hono/swagger-ui"
import type { MiddlewareHandler } from "hono"
import { createAuthenticator, headerIdentity, isPublicApiPath, signInNeeded } from "./auth/identity"
import { requireInScope, requireReach } from "./auth/scope"
import { authOff, type AuthSettings } from "./auth/settings"
import { BoardError, notFound, unauthenticated } from "./board/errors"
import { hooksPath, receiveHook, type HookSettings } from "./board/hook-route"
import { viewerOf } from "./board/visibility"
import type { Database } from "./db/client"
import type { ObjectStore } from "./storage/store"
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
import { focusRoutes } from "./routes/focus"
import { keyRoutes } from "./routes/keys"
import { machineRoutes } from "./routes/machines"
import { memberRoutes } from "./routes/members"
import { memoryRoutes } from "./routes/memory"
import { documentRoutes } from "./routes/documents"
import { blockRoutes } from "./routes/blocks"
import { scheduledRoutes } from "./routes/scheduled"
import { attachmentRoutes } from "./routes/attachments"
import { messageRoutes } from "./routes/messages"
import { navigationRoutes } from "./routes/navigation"
import { orgRoutes } from "./routes/orgs"
import { planRoutes } from "./routes/plans"
import { questionRoutes } from "./routes/questions"
import { reviewRoutes } from "./routes/review"
import { routineRoutes } from "./routes/routines"
import { searchRoutes } from "./routes/search"
import { sessionRoutes } from "./routes/sessions"
import { router, type AppEnv } from "./routes/shared"
import { taskRoutes } from "./routes/tasks"
import { threadRoutes } from "./routes/threads"
import { waitRoutes } from "./routes/wait"

const info = {
  title: "Flockr",
  version: "0.1.0",
  description: `A shared board for people and agents: channels, threads and tasks with claims and leases. With sign-in off (the default) the acting member is the ${memberHeader} header (default ${defaultMember}). With sign-in on, every request needs a session cookie (${authBasePath}) or a key sent as Authorization: Bearer <key>; the header then only picks an agent the signed-in person owns.`,
}

export interface AppOptions {
  auth?: AuthSettings
  modelProxy?: ModelProxySettings | null
  hooks?: HookSettings | null
  objects?: ObjectStore | null
}

export function createApp(db: Database, options: AppOptions = {}) {
  const app = router()
  const authenticator = createAuthenticator(db, options.auth ?? authOff)

  const identify: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.path.startsWith(`${modelProxyPath}/`)) return next()
    if (c.req.path.startsWith(`${hooksPath}/`)) return next()
    c.set("db", db)
    c.set("auth", authenticator)
    if (authenticator.mode !== "off" && isPublicApiPath(c.req.path)) return next()
    const open = authenticator.mode === "off" || isPublicApiPath(c.req.path)
    const identity = open ? headerIdentity(c.req.raw.headers) : await authenticator.identify(c.req.raw.headers)
    if (!identity) throw unauthenticated(signInNeeded)
    c.set("member", identity.member)
    c.set("via", identity.via)
    c.set("channels", identity.channels)
    const viewer = viewerOf(identity.member, identity.channels)
    c.set("viewer", viewer)
    const request = c.req.raw
    const scoped = { method: request.method, pathname: c.req.path, query: new URL(request.url).searchParams, body: () => request.clone().json().catch(() => null) }
    await requireInScope(db, identity.channels, scoped)
    await requireReach(db, viewer, scoped)
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
    .route("/", orgRoutes)
    .route("/", claimRoutes)
    .route("/", taskRoutes)
    .route("/", areaRoutes)
    .route("/", checklistRoutes)
    .route("/", flowRoutes)
    .route("/", reviewRoutes)
    .route("/", questionRoutes)
    .route("/", eventRoutes)
    .route("/", waitRoutes)
    .route("/", activityRoutes)
    .route("/", activityEntryRoutes)
    .route("/", agentRoutes)
    .route("/", memoryRoutes)
    .route("/", documentRoutes)
    .route("/", blockRoutes)
    .route("/", scheduledRoutes)
    .route("/", machineRoutes)
    .route("/", searchRoutes)
    .route("/", routineRoutes)
    .route("/", approvalRoutes)
    .route("/", keyRoutes)
    .route("/", navigationRoutes)
    .route("/", planRoutes)
    .route("/", focusRoutes)
    .route("/", sessionRoutes(options.objects ?? null))
    .route("/", attachmentRoutes(options.objects ?? null))
    .route("/", authRoutes)

  const document = () => api.getOpenAPI31Document({ openapi: "3.1.0", info })

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
