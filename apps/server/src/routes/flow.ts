import { AddCommitBody, CompleteBody, ReasonBody, Task, TaskParams } from "@flockr/contracts"
import { addTaskCommit } from "../board/commits"
import { blockTask, completeTask, failTask, submitForReview, unblockTask } from "../board/flow"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["tasks"]

export const flowRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/commits",
      operationId: "addTaskCommit",
      tags,
      summary: "Add a commit that did this task, in any state. Adding a sha the task already has changes nothing.",
      request: { params: TaskParams, body: jsonBody(AddCommitBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await addTaskCommit(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/complete",
      operationId: "completeTask",
      tags,
      summary: "Mark a claimed task done, with an optional commit and a note as proof. Tasks waiting on it turn ready.",
      request: { params: TaskParams, body: jsonBody(CompleteBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await completeTask(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/submit",
      operationId: "submitForReview",
      tags,
      summary: "Send a claimed task for review by a person, with an optional commit and note",
      request: { params: TaskParams, body: jsonBody(CompleteBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await submitForReview(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/fail",
      operationId: "failTask",
      tags,
      summary: "Give up on a claimed task with a reason. It becomes blocked and unheld.",
      request: { params: TaskParams, body: jsonBody(ReasonBody) },
      responses: ok(Task),
    }),
    async (c) => {
      const body = c.req.valid("json")
      return c.json(await failTask(c.var.db, c.var.member, c.req.valid("param").id, body.reason, body.epoch), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/block",
      operationId: "blockTask",
      tags,
      summary: "Block a ready or claimed task with a reason",
      request: { params: TaskParams, body: jsonBody(ReasonBody) },
      responses: ok(Task),
    }),
    async (c) => {
      const body = c.req.valid("json")
      return c.json(await blockTask(c.var.db, c.var.member, c.req.valid("param").id, body.reason, body.epoch), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/unblock",
      operationId: "unblockTask",
      tags,
      summary: "Unblock a task: back to its holder with a new lease, or ready if nobody holds it",
      request: { params: TaskParams },
      responses: ok(Task),
    }),
    async (c) => c.json(await unblockTask(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
