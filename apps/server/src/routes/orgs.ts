import { CreateOrgBody, Org, OrgParams, UpdateOrgBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createOrg, listOrgs, updateOrg } from "../board/orgs"
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
  .openapi(
    operation({
      method: "patch",
      path: "/api/orgs/{id}",
      operationId: "updateOrg",
      tags,
      summary:
        "Rename a client org, name its owner (a person in it), or turn self-invites on or off (off by default). With self-invites on, the owner invites people into that org only, and sees and revokes only its invites; turning it off revokes the open invites its people sent. Only a person in the org that runs the board",
      request: { params: OrgParams, body: jsonBody(UpdateOrgBody) },
      responses: ok(Org),
    }),
    async (c) => c.json(await updateOrg(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
