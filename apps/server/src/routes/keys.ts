import { CreatedKey, CreateKeyBody, KeyParams, MemberKey, MemberParams, RescopeKeyBody, RevokedKeys } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createKey, listKeys, rescopeKey, revokeKey, revokeMemberKeys, rotateKey } from "../board/keys"
import { credentialOf, jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["keys"]

const whoMay = "Only a signed-in person of the org that runs the board, or a provisioning key for the agent keys it made; a member key never manages keys"

export const keyRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/keys",
      operationId: "listKeys",
      tags,
      summary: `Every key on the board: whose it is, its kind, its owner, the channels it is limited to, when it was last used or rotated and whether it is revoked. Never the key itself. A provisioning key lists only the keys it made. ${whoMay}`,
      responses: ok(z.array(MemberKey)),
    }),
    async (c) => c.json(await listKeys(c.var.db, c.var.member, credentialOf(c)), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/keys",
      operationId: "createKey",
      tags,
      summary: `Make a key that acts as a member, optionally limited to some channels; the key is in the response once and never again. kind provisioning makes an admin key that acts as the person making it and can only manage agent keys within its channels. A provisioning key makes member keys for agents only, inside its own channels. ${whoMay}`,
      request: { body: jsonBody(CreateKeyBody) },
      responses: ok(CreatedKey),
    }),
    async (c) => c.json(await createKey(c.var.db, c.var.member, c.req.valid("json"), credentialOf(c)), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/keys/{id}/revoke",
      operationId: "revokeKey",
      tags,
      summary: `Turn a key off for good; requests with it are refused from now on. Safe to repeat. ${whoMay}`,
      request: { params: KeyParams },
      responses: ok(MemberKey),
    }),
    async (c) => c.json(await revokeKey(c.var.db, c.var.member, c.req.valid("param").id, credentialOf(c)), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/keys/{id}/rotate",
      operationId: "rotateKey",
      tags,
      summary: `Replace a key's secret and keep its id, kind, member and channels; the old secret is refused at once and its live feeds are cut. The new secret is in the response once. A revoked key cannot be rotated. ${whoMay}`,
      request: { params: KeyParams },
      responses: ok(CreatedKey),
    }),
    async (c) => c.json(await rotateKey(c.var.db, c.var.member, c.req.valid("param").id, credentialOf(c)), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/keys/{id}",
      operationId: "rescopeKey",
      tags,
      summary: `Change the channels a key is limited to and keep its id and secret; its live feeds are cut so they reconnect with the new limit. Safe to repeat. ${whoMay}`,
      request: { params: KeyParams, body: jsonBody(RescopeKeyBody) },
      responses: ok(MemberKey),
    }),
    async (c) => c.json(await rescopeKey(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json"), credentialOf(c)), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/members/{name}/keys/revoke",
      operationId: "revokeMemberKeys",
      tags,
      summary: "Turn off every live key a member has, at once; requests with any of them are refused from now on and their live feeds are cut. Pausing, stopping or deleting an agent does this too. Safe to repeat. Only a signed-in person of the org that runs the board",
      request: { params: MemberParams },
      responses: ok(RevokedKeys),
    }),
    async (c) => c.json(await revokeMemberKeys(c.var.db, c.var.member, c.req.valid("param").name, credentialOf(c)), 200),
  )
