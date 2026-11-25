import { Channel, ChannelParams, CreateChannelBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createChannel, markRead } from "../board/channels"
import { listChannels } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["channels"]

export const channelRoutes = router()
  .openapi(
    operation({ method: "get", path: "/api/channels", operationId: "listChannels", tags, summary: "List channels with the acting member's unread counts", responses: ok(z.array(Channel)) }),
    async (c) => c.json(await listChannels(c.var.db, c.var.member), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels",
      operationId: "createChannel",
      tags,
      summary: "Create a channel",
      request: { body: jsonBody(CreateChannelBody) },
      responses: ok(Channel),
    }),
    async (c) => {
      const body = c.req.valid("json")
      return c.json(await createChannel(c.var.db, c.var.member, body.id, body.topic), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/read",
      operationId: "markRead",
      tags,
      summary: "Mark a channel as read for the acting member",
      request: { params: ChannelParams },
      responses: ok(z.object({ lastReadId: z.number().int() })),
    }),
    async (c) => c.json(await markRead(c.var.db, c.var.member, c.req.valid("param").channel), 200),
  )
