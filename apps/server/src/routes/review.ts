import { ChangesBody, Task, TaskParams } from "@flockr/contracts"
import { approveTask, requestChanges } from "../board/flow"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["review"]

export const reviewRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/approve",
      operationId: "approveTask",
      tags,
      summary: "Approve a task in review. It is done and tasks waiting on it turn ready.",
      request: { params: TaskParams },
      responses: ok(Task),
    }),
    async (c) => c.json(await approveTask(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/changes",
      operationId: "requestChanges",
      tags,
      summary: "Send a task in review back to its holder with a note",
      request: { params: TaskParams, body: jsonBody(ChangesBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await requestChanges(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").note), 200),
  )
