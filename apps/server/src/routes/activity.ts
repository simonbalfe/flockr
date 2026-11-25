import { Activity, ActivityBody, ActivityResult, ThreadParams } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { listActivity, setActivity } from "../board/activity"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["activity"]

export const activityRoutes = router()
  .openapi(
    operation({
      method: "put",
      path: "/api/threads/{id}/activity",
      operationId: "setActivity",
      tags,
      summary:
        "Say the acting member is working in a thread (working: true, repeat it to keep it showing) or has stopped (working: false). Sent live to every client; it is current state, not event history.",
      request: { params: ThreadParams, body: jsonBody(ActivityBody) },
      responses: ok(ActivityResult),
    }),
    async (c) => c.json({ activity: await setActivity(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").working) }, 200),
  )
  .openapi(
    operation({ method: "get", path: "/api/activity", operationId: "listActivity", tags, summary: "Who is working in which thread right now", responses: ok(z.array(Activity)) }),
    async (c) => c.json(await listActivity(c.var.db), 200),
  )
