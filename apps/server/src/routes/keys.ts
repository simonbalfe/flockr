import { CreatedKey, CreateKeyBody, KeyParams, MemberKey } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createKey, listKeys, revokeKey } from "../board/keys"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["keys"]

export const keyRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/keys",
      operationId: "listKeys",
      tags,
      summary: "Every key on the board: whose it is, its owner, the channels it is limited to, when it was last used and whether it is revoked. Never the key itself. Only a person can list keys",
      responses: ok(z.array(MemberKey)),
    }),
    async (c) => c.json(await listKeys(c.var.db, c.var.member), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/keys",
      operationId: "createKey",
      tags,
      summary: "Make a key that acts as a member, optionally limited to some channels. The key is in the response once and never again. Only a person can make one",
      request: { body: jsonBody(CreateKeyBody) },
      responses: ok(CreatedKey),
    }),
    async (c) => c.json(await createKey(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/keys/{id}/revoke",
      operationId: "revokeKey",
      tags,
      summary: "Turn a key off for good; requests with it are refused from now on. Safe to repeat. Only a person can revoke one",
      request: { params: KeyParams },
      responses: ok(MemberKey),
    }),
    async (c) => c.json(await revokeKey(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
