import { CreateInviteBody, Invite, InviteParams } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createInvite, listInvites, revokeInvite, type InviteMail } from "../board/invites"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["orgs"]

export const inviteRoutes = (mail: InviteMail) =>
  router()
    .openapi(
      operation({
        method: "post",
        path: "/api/invites",
        operationId: "createInvite",
        tags,
        summary:
          "Invite a person by email into an org, as a new member name. They sign in with a one-time link sent to that address; the first sign-in makes them a member. A signed-in person of the org that runs the board invites into any org, and a client org's owner into their own org once it has self-invites on; never a key. The invite lasts 7 days",
        request: { body: jsonBody(CreateInviteBody) },
        responses: ok(Invite),
      }),
      async (c) => c.json(await createInvite(c.var.db, mail, { actor: c.var.member, via: c.var.via }, c.req.valid("json")), 200),
    )
    .openapi(
      operation({ method: "get", path: "/api/invites", operationId: "listInvites", tags, summary: "Invites, newest first: open, accepted, revoked or expired. A client org's owner sees only their org's", responses: ok(z.array(Invite)) }),
      async (c) => c.json(await listInvites(c.var.db, { actor: c.var.member, via: c.var.via }), 200),
    )
    .openapi(
      operation({
        method: "post",
        path: "/api/invites/{id}/revoke",
        operationId: "revokeInvite",
        tags,
        summary: "Close an open invite so its address can no longer sign in; safe to repeat",
        request: { params: InviteParams },
        responses: ok(Invite),
      }),
      async (c) => c.json(await revokeInvite(c.var.db, { actor: c.var.member, via: c.var.via }, c.req.valid("param").id), 200),
    )
