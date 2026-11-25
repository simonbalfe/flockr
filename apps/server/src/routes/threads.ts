import { Reply, ReplyBody, Task, Thread, ThreadParams } from "@flockr/contracts"
import { reply } from "../board/messages"
import { getThread } from "../board/read"
import { makeTaskFromThread } from "../board/tasks"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["threads"]

export const threadRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/threads/{id}",
      operationId: "getThread",
      tags,
      summary: "Read a thread: a message id (m12) gives the message and its replies, a task id (806) gives the task thread",
      request: { params: ThreadParams },
      responses: ok(Thread),
    }),
    async (c) => c.json(await getThread(c.var.db, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/threads/{id}/replies",
      operationId: "replyToThread",
      tags,
      summary:
        "Reply in a thread (m12 or 806), optionally with labels. Replying to a reply (m20) starts or continues its sub-thread; replying to a reply inside a sub-thread lands in that same sub-thread. On a task thread, send your claim epoch so a stale claim is refused.",
      request: { params: ThreadParams, body: jsonBody(ReplyBody) },
      responses: ok(Reply),
    }),
    async (c) => c.json(await reply(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/threads/{id}/task",
      operationId: "makeTaskFromThread",
      tags,
      summary: "Make a ready task from a message thread, copying its replies into the task thread",
      request: { params: ThreadParams },
      responses: ok(Task),
    }),
    async (c) => c.json(await makeTaskFromThread(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
