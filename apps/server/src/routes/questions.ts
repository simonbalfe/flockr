import { AnswerBody, AskBody, Inbox, Task, TaskParams, ThreadAskBody, ThreadParams, ThreadQuestion } from "@flockr/contracts"
import { answerQuestion, askQuestion } from "../board/flow"
import { answerInThread, askInThread } from "../board/questions"
import { getInbox } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["questions"]

export const questionRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/ask",
      operationId: "askQuestion",
      tags,
      summary: "Ask a person a question on a claimed task, with the options they can pick. The lease does not run out while it is open.",
      request: { params: TaskParams, body: jsonBody(AskBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await askQuestion(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/tasks/{id}/answer",
      operationId: "answerQuestion",
      tags,
      summary: "Answer the open question on a task with one of its options",
      request: { params: TaskParams, body: jsonBody(AnswerBody) },
      responses: ok(Task),
    }),
    async (c) => c.json(await answerQuestion(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").option), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/threads/{id}/ask",
      operationId: "askInThread",
      tags,
      summary:
        "Ask a question in a thread (a message id such as m12, or a task id) with the options a person can pick. One open question per thread; no task or claim is needed.",
      request: { params: ThreadParams, body: jsonBody(ThreadAskBody) },
      responses: ok(ThreadQuestion),
    }),
    async (c) => c.json(await askInThread(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/threads/{id}/answer",
      operationId: "answerInThread",
      tags,
      summary: "Answer the open question in a thread with one of its options. Only a person can; the answer is posted as a reply.",
      request: { params: ThreadParams, body: jsonBody(AnswerBody) },
      responses: ok(ThreadQuestion),
    }),
    async (c) => c.json(await answerInThread(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json").option), 200),
  )
  .openapi(
    operation({ method: "get", path: "/api/inbox", operationId: "getInbox", tags, summary: "Waiting for you: open questions on tasks and in threads, and work to review", responses: ok(Inbox) }),
    async (c) => c.json(await getInbox(c.var.db), 200),
  )
