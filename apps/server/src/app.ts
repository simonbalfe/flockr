import { defaultMember, memberHeader } from "@flockr/contracts"
import { swaggerUI } from "@hono/swagger-ui"
import { BoardError } from "./board/errors"
import type { Database } from "./db/client"
import { mcpHandler } from "./mcp/server"
import { activityRoutes } from "./routes/activity"
import { activityEntryRoutes } from "./routes/activity-entries"
import { agentRoutes } from "./routes/agents"
import { channelRoutes } from "./routes/channels"
import { checklistRoutes } from "./routes/checklist"
import { claimRoutes } from "./routes/claims"
import { eventRoutes } from "./routes/events"
import { flowRoutes } from "./routes/flow"
import { machineRoutes } from "./routes/machines"
import { memberRoutes } from "./routes/members"
import { messageRoutes } from "./routes/messages"
import { questionRoutes } from "./routes/questions"
import { reviewRoutes } from "./routes/review"
import { searchRoutes } from "./routes/search"
import { router } from "./routes/shared"
import { taskRoutes } from "./routes/tasks"
import { threadRoutes } from "./routes/threads"

const info = {
  title: "Flockr",
  version: "0.1.0",
  description: `A shared board for people and agents: channels, threads and tasks with claims and leases. There is no authentication yet: the acting member is the ${memberHeader} header (default ${defaultMember}).`,
}

export function createApp(db: Database) {
  const app = router()

  app.use("/api/*", async (c, next) => {
    c.set("db", db)
    c.set("member", c.req.header(memberHeader)?.trim() || defaultMember)
    await next()
  })

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
    .route("/", checklistRoutes)
    .route("/", flowRoutes)
    .route("/", reviewRoutes)
    .route("/", questionRoutes)
    .route("/", eventRoutes)
    .route("/", activityRoutes)
    .route("/", activityEntryRoutes)
    .route("/", agentRoutes)
    .route("/", machineRoutes)
    .route("/", searchRoutes)

  const document = () => api.getOpenAPI31Document({ openapi: "3.1.0", info })

  api.get("/api/openapi.json", (c) => c.json(document()))
  api.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }))
  api.notFound((c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}; see /api/openapi.json`, kind: "not_found" }, 404))

  const mcp = mcpHandler({ document, dispatch: (url, init) => Promise.resolve(api.request(url, init)), defaultMember })
  api.all("/mcp", (c) => mcp(c.req.raw))

  return Object.assign(api, { document })
}

export type FlockrApp = ReturnType<typeof createApp>
