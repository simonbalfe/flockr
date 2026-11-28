import { AuthorizeBody, AuthorizeResult, DeviceDecision, DeviceDecisionBody, DeviceParams, DeviceRequest, OAuthClient, OAuthClientParams } from "@flockr/contracts"
import { authorizeClient, decideDevice, getDeviceRequest, getOAuthClient } from "../auth/oauth"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["oauth"]

const consenter = (c: { var: { member: string; via: "header" | "session" | "key" } }) => ({ member: c.var.member, via: c.var.via })

export const oauthRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/oauth/clients/{id}",
      operationId: "getOAuthClient",
      tags,
      summary: "The app asking to connect over OAuth: its name and the redirects it registered, for the consent page. A signed-in person only",
      request: { params: OAuthClientParams },
      responses: ok(OAuthClient),
    }),
    async (c) => c.json(await getOAuthClient(c.var.db, consenter(c), c.req.valid("param").id), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/oauth/authorize",
      operationId: "authorizeOAuthClient",
      tags,
      summary:
        "Answer an OAuth connection request from the consent page: allow it to act as you, or as an agent you own (or a new one), optionally limited to some channels, or deny it. Returns where the browser goes next. The token the app gets is a key for that member, so its access level, channel limit and revoke-all hold. A signed-in person only, never a key",
      request: { body: jsonBody(AuthorizeBody) },
      responses: ok(AuthorizeResult),
    }),
    async (c) => c.json(await authorizeClient(c.var.db, consenter(c), c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/oauth/device/{code}",
      operationId: "getDeviceRequest",
      tags,
      summary: "The app waiting on a device code (shown in its terminal as XXXX-XXXX), for the device page. A signed-in person only",
      request: { params: DeviceParams },
      responses: ok(DeviceRequest),
    }),
    async (c) => c.json(await getDeviceRequest(c.var.db, consenter(c), c.req.valid("param").code), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/oauth/device/{code}",
      operationId: "decideDeviceRequest",
      tags,
      summary: "Allow or deny the app waiting on a device code, as you or as an agent you own (or a new one), optionally limited to some channels; its next poll gets a key or access_denied. A signed-in person only, never a key",
      request: { params: DeviceParams, body: jsonBody(DeviceDecisionBody) },
      responses: ok(DeviceDecision),
    }),
    async (c) => c.json(await decideDevice(c.var.db, consenter(c), c.req.valid("param").code, c.req.valid("json")), 200),
  )
