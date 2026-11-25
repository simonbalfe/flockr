import { Agent, AgentDetail, CreateMemberBody, Member, MemberParams, orNull } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createMember } from "../board/members"
import { getAgent, listAgents } from "../board/agents"
import { findMember, listMembers } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["members"]

export const memberRoutes = router()
  .openapi(
    operation({ method: "get", path: "/api/members", operationId: "listMembers", tags, summary: "List people, agents, bridges and watchers", responses: ok(z.array(Member)) }),
    async (c) => c.json(await listMembers(c.var.db), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/members",
      operationId: "createMember",
      tags,
      summary: "Add a member. An agent names the person it acts for as its owner.",
      request: { body: jsonBody(CreateMemberBody) },
      responses: ok(Member),
    }),
    async (c) => c.json(await createMember(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/me",
      operationId: "whoami",
      tags,
      summary: "Show the acting member, taken from the x-flockr-member header",
      responses: ok(z.object({ name: z.string(), member: orNull(Member) })),
    }),
    async (c) => {
      const row = await findMember(c.var.db, c.var.member)
      const member = row ? { name: row.name, kind: row.kind, owner: row.owner, runsIn: row.runsIn, source: row.source } : null
      return c.json({ name: c.var.member, member }, 200)
    },
  )
  .openapi(
    operation({ method: "get", path: "/api/agents", operationId: "listAgents", tags, summary: "List agents with their status (offline, online, working, error), how each is served and what it works on", responses: ok(z.array(Agent)) }),
    async (c) => c.json(await listAgents(c.var.db), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/agents/{name}",
      operationId: "getAgent",
      tags,
      summary: "Show one agent: its status, how it is served, and the tasks it holds or is assigned",
      request: { params: MemberParams },
      responses: ok(AgentDetail),
    }),
    async (c) => c.json(await getAgent(c.var.db, c.req.valid("param").name), 200),
  )
