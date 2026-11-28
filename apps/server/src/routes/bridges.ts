import { Bridge, BridgeChannelParams, BridgeList, BridgeParams, LinkBridgeBody } from "@flockr/contracts"
import { linkBridgeChannel, linkBridgePerson, listBridges, unlinkBridgeChannel, unlinkBridgePerson } from "../board/bridges"
import type { BridgeSettings } from "../chat-bridges"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["bridges"]

export const bridgeRoutes = (settings: BridgeSettings) =>
  router()
    .openapi(
      operation({
        method: "get",
        path: "/api/bridges",
        operationId: "listBridges",
        tags,
        summary: "Chat bridges (Slack sync): whether each is on, the channels linked to it that you can see, and the people linked to a user there. The server holds the tokens; no agent does",
        responses: ok(BridgeList),
      }),
      async (c) => c.json({ bridges: await listBridges(c.var.db, c.var.viewer, settings) }, 200),
    )
    .openapi(
      operation({
        method: "put",
        path: "/api/bridges/{bridge}/channels/{channel}",
        operationId: "linkBridgeChannel",
        tags,
        summary: "Link a channel to a channel on the chat platform, so messages, replies and cards sync both ways. Only a host-org person can, and only for an org-wide host-org channel (private and shared channels stay off); safe to repeat",
        request: { params: BridgeChannelParams, body: jsonBody(LinkBridgeBody) },
        responses: ok(Bridge),
      }),
      async (c) => {
        const { bridge, channel } = c.req.valid("param")
        return c.json(await linkBridgeChannel(c.var.db, c.var.viewer, { bridge, channel, external: c.req.valid("json").external }, settings), 200)
      },
    )
    .openapi(
      operation({
        method: "delete",
        path: "/api/bridges/{bridge}/channels/{channel}",
        operationId: "unlinkBridgeChannel",
        tags,
        summary: "Stop syncing a channel with the chat platform; safe to repeat",
        request: { params: BridgeChannelParams },
        responses: ok(Bridge),
      }),
      async (c) => c.json(await unlinkBridgeChannel(c.var.db, c.var.viewer, c.req.valid("param"), settings), 200),
    )
    .openapi(
      operation({
        method: "put",
        path: "/api/bridges/{bridge}/people/me",
        operationId: "linkBridgePerson",
        tags,
        summary: "Link your own user id on the chat platform to you, so your messages there post as you and your button presses there count. People in the host org only; safe to repeat",
        request: { params: BridgeParams, body: jsonBody(LinkBridgeBody) },
        responses: ok(Bridge),
      }),
      async (c) => c.json(await linkBridgePerson(c.var.db, c.var.viewer, { bridge: c.req.valid("param").bridge, external: c.req.valid("json").external }, settings), 200),
    )
    .openapi(
      operation({
        method: "delete",
        path: "/api/bridges/{bridge}/people/me",
        operationId: "unlinkBridgePerson",
        tags,
        summary: "Forget your user id on the chat platform; your messages there post as unlinked again and your presses stop counting. Safe to repeat",
        request: { params: BridgeParams },
        responses: ok(Bridge),
      }),
      async (c) => c.json(await unlinkBridgePerson(c.var.db, c.var.viewer, c.req.valid("param"), settings), 200),
    )
