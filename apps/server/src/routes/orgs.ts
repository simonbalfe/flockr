import { CreateOrgBody, Org } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createOrg, listOrgs } from "../board/orgs"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["orgs"]

export const orgRoutes = router()
  .openapi(
    operation({ method: "get", path: "/api/orgs", operationId: "listOrgs", tags, summary: "List the orgs you can see: your own, and those of members who share a channel with you", responses: ok(z.array(Org)) }),
    async (c) => c.json(await listOrgs(c.var.db, c.var.viewer), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/orgs",
      operationId: "createOrg",
      tags,
      summary: "Add a client org. Its members see only the channels shared with them. Only the org that runs the board can add one.",
      request: { body: jsonBody(CreateOrgBody) },
      responses: ok(Org),
    }),
    async (c) => c.json(await createOrg(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
