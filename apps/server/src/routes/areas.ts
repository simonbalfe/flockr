import { AreaParams, ChannelParams, DeclareAreaBody, DeclareAreaResult, WorkingArea } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { declareArea, listAreas, releaseArea, renewArea } from "../board/areas"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["areas"]

export const areaRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/areas",
      operationId: "listAreas",
      tags,
      summary: "List the live working areas in a channel: who is working in which files or folders, for which task and branch",
      request: { params: ChannelParams },
      responses: ok(z.array(WorkingArea)),
    }),
    async (c) => c.json(await listAreas(c.var.db, c.req.valid("param").channel), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/areas",
      operationId: "declareArea",
      tags,
      summary:
        "Say which files, folders or globs you are about to edit, for a task you hold or on their own. Another member's live area that meets yours comes back as overlaps (a warning); with overlap refuse it is a 409 and nothing is declared. Declaring again for the same task replaces its paths.",
      request: { params: ChannelParams, body: jsonBody(DeclareAreaBody) },
      responses: ok(DeclareAreaResult),
    }),
    async (c) => c.json(await declareArea(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/areas/{id}/renew",
      operationId: "renewArea",
      tags,
      summary: "Renew an area that has no task for another hour; an area with a task lives as long as the task's claim",
      request: { params: AreaParams },
      responses: ok(WorkingArea),
    }),
    async (c) => c.json(await renewArea(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/areas/{id}/release",
      operationId: "releaseArea",
      tags,
      summary: "Say you have stopped working in an area; safe to repeat. Only its owner or a person can release it",
      request: { params: AreaParams },
      responses: ok(WorkingArea),
    }),
    async (c) => c.json(await releaseArea(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("param").id), 200),
  )
