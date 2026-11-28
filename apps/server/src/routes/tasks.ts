import { CreateTaskBody, GiveBody, HandoffBody, ListTasksQuery, Task, TaskParams } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { handOffTask } from "../board/handoff"
import { getTask, listTasks } from "../board/read"
import { createTask, giveTask } from "../board/tasks"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["tasks"]

export const taskRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/tasks",
      operationId: "listTasks",
      tags,
      summary: "List tasks, filtered by channel, state, assignee or a member who holds or is assigned them",
      request: { query: ListTasksQuery },
      responses: ok(z.array(Task)),
    }),
    async (c) => c.json(await listTasks(c.var.db, c.req.valid("query"), c.var.viewer), 200),
  )
  .openapi(
    operation({ method: "get", path: "/api/tasks/{id}", operationId: "getTask", tags, summary: "Show one task", request: { params: TaskParams }, responses: ok(Task) }),
    async (c) => c.json(await getTask(c.var.db, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks",
      operationId: "createTask",
      tags,
      summary: "Create a task in a channel. It is ready, or waiting until every task it needs is done.",
      request: { body: jsonBody(CreateTaskBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await createTask(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/give",
      operationId: "giveTask",
      tags,
      summary: "Assign a ready or waiting task to a member",
      request: { params: TaskParams, body: jsonBody(GiveBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await giveTask(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").to), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/handoff",
      operationId: "handOffTask",
      tags,
      summary:
        "Hand a claimed task you hold to another member, with a note: they hold it now under a new claim epoch with a fresh lease, the thread gets the note, and its branch and working areas move with it. Your old epoch is refused afterwards; repeating the same call changes nothing.",
      request: { params: TaskParams, body: jsonBody(HandoffBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await handOffTask(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
