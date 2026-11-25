import { Channel, ChannelParams, CreateChannelBody, UpdateChannelBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createChannel, markRead, updateChannel } from "../board/channels"
import { listChannels } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["channels"]

export const channelRoutes = router()
  .openapi(
    operation({ method: "get", path: "/api/channels", operationId: "listChannels", tags, summary: "List channels with the acting member's unread counts", responses: ok(z.array(Channel)) }),
    async (c) => c.json(await listChannels(c.var.db, c.var.member, { direct: c.var.channels === null }), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels",
      operationId: "createChannel",
      tags,
      summary: "Create a channel, optionally naming the repo its commits link to",
      request: { body: jsonBody(CreateChannelBody) },
      responses: ok(Channel),
    }),
    async (c) => c.json(await createChannel(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/channels/{channel}",
      operationId: "updateChannel",
      tags,
      summary: "Change a channel's topic or repo. The repo (github.com/owner/name) turns its tasks' commits into links; null clears it.",
      request: { params: ChannelParams, body: jsonBody(UpdateChannelBody) },
      responses: ok(Channel),
    }),
    async (c) => c.json(await updateChannel(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json")), 200),
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
