import { ApproveBody, ChangesBody, SetReviewerBody, Task, TaskParams } from "@flockr/contracts"
import { approveTask, requestChanges, setTaskReviewer } from "../board/review"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["review"]

export const reviewRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/approve",
      operationId: "approveTask",
      tags,
      summary:
        "Approve a task in review: a person, or the agent named as its reviewer when the channel lets agents approve; never its holder. Send the commit you reviewed: once a newer commit lands it is refused with 409 stale_review. It is done and tasks waiting on it turn ready; repeating your approval changes nothing.",
      request: { params: TaskParams, body: jsonBody(ApproveBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await approveTask(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/changes",
      operationId: "requestChanges",
      tags,
      summary: "Send a task in review back to its holder with a note: a person or the named reviewer, never the holder",
      request: { params: TaskParams, body: jsonBody(ChangesBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await requestChanges(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").note), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/tasks/{id}/reviewer",
      operationId: "setTaskReviewer",
      tags,
      summary:
        "Name the member who reviews a task, or null for a person. A person or the task's holder sets it; the reviewer must see the channel and cannot hold the task. With a reviewer named the task is done only by approval. An agent with 2 reviews open is refused with 409 review_full.",
      request: { params: TaskParams, body: jsonBody(SetReviewerBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await setTaskReviewer(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
