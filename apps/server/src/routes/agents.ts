import { AgentDetail, AgentParams, CreateAgentBody, DeletedAgent, UpdateAgentBody } from "@flockr/contracts"
import { createAgent, deleteAgent, startAgent, stopAgent, updateAgent } from "../board/agents"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["agents"]

export const agentRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/agents",
      operationId: "createAgent",
      tags,
      summary: "Create an agent served by a machine's runner, owned by the acting person, and start it. Its first session starts when someone talks to it.",
      request: { body: jsonBody(CreateAgentBody) },
      responses: ok(AgentDetail),
    }),
    async (c) => c.json(await createAgent(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/agents/{name}",
      operationId: "updateAgent",
      tags,
      summary: "Change an agent's folder, permissions, personality or model; its next session uses them",
      request: { params: AgentParams, body: jsonBody(UpdateAgentBody) },
      responses: ok(AgentDetail),
    }),
    async (c) => c.json(await updateAgent(c.var.db, c.var.member, c.req.valid("param").name, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/agents/{name}/start",
      operationId: "startAgent",
      tags,
      summary: "Start serving an agent on its machine; safe to repeat",
      request: { params: AgentParams },
      responses: ok(AgentDetail),
    }),
    async (c) => c.json(await startAgent(c.var.db, c.var.member, c.req.valid("param").name), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/agents/{name}/stop",
      operationId: "stopAgent",
      tags,
      summary: "Stop an agent: its sessions end, its claims are released and it ignores mentions until started; safe to repeat",
      request: { params: AgentParams },
      responses: ok(AgentDetail),
    }),
    async (c) => c.json(await stopAgent(c.var.db, c.var.member, c.req.valid("param").name), 200),
  )
  .openapi(
    operation({
      method: "delete",
      path: "/api/agents/{name}",
      operationId: "deleteAgent",
      tags,
      summary: "Stop an agent and remove it from the board; its messages keep their author; safe to repeat",
      request: { params: AgentParams },
      responses: ok(DeletedAgent),
    }),
    async (c) => c.json(await deleteAgent(c.var.db, c.var.member, c.req.valid("param").name), 200),
  )
