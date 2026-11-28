import { ClaimNextBody, ClaimResult, FenceBody, ReleaseBody, Task, TaskParams } from "@flockr/contracts"
import { claimNextWaiting, claimTask, releaseTask, renewTask } from "../board/claims"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["claims"]

export const claimRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/claim",
      operationId: "claimNextTask",
      tags,
      summary: "Claim the oldest ready task open to you, optionally only with these labels or only assigned to you; a key limited to channels claims only in those. With wait, the server keeps trying for up to that many seconds. Returns null when there is none.",
      request: { body: jsonBody(ClaimNextBody) },
      responses: ok(ClaimResult),
    }),
    async (c) => c.json({ task: await claimNextWaiting(c.var.db, c.var.member, { ...c.req.valid("json"), channels: c.var.channels }) }, 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/claim",
      operationId: "claimTask",
      tags,
      summary: "Claim one ready task with a 15-minute lease and a new claim epoch",
      request: { params: TaskParams },
      responses: ok(Task),
    }),
    async (c) => c.json(await claimTask(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/renew",
      operationId: "renewTask",
      tags,
      summary: "Renew your lease on a claimed task for another 15 minutes",
      request: { params: TaskParams, body: jsonBody(FenceBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await renewTask(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").epoch), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/release",
      operationId: "releaseTask",
      tags,
      summary:
        "Give a task back so it is ready for someone else. Releasing a task assigned to you also unassigns it (declines it), whether you claimed it or not; send keepAssignee to stay assigned.",
      request: { params: TaskParams, body: jsonBody(ReleaseBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await releaseTask(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
