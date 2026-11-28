import { Channel, ChannelMember, ChannelMemberParams, ChannelParams, CreateChannelBody, UpdateChannelBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createChannel, markRead, updateChannel } from "../board/channels"
import { addChannelMember, listChannelMembers, removeChannelMember } from "../board/orgs"
import { listChannels } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["channels"]

export const channelRoutes = router()
  .openapi(
    operation({ method: "get", path: "/api/channels", operationId: "listChannels", tags, summary: "List channels with the acting member's unread counts", responses: ok(z.array(Channel)) }),
    async (c) => c.json(await listChannels(c.var.db, c.var.viewer), 200),
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
      summary: "Change a channel's topic, repo or visibility (share it with other orgs, or keep it to the owning org or its listed members). The repo (github.com/owner/name) turns its tasks' commits into links; null clears it.",
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
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/members",
      operationId: "listChannelMembers",
      tags,
      summary: "List a channel's listed members with their org: the two of a DM, or those added to a private or shared channel. Everyone in the owning org also sees an org or shared channel.",
      request: { params: ChannelParams },
      responses: ok(z.array(ChannelMember)),
    }),
    async (c) => c.json(await listChannelMembers(c.var.db, c.req.valid("param").channel), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/channels/{channel}/members/{name}",
      operationId: "addChannelMember",
      tags,
      summary: "Add a member to a channel. A member of another org joins only a shared channel; only members of the owning org add anyone. Adding a member already listed changes nothing.",
      request: { params: ChannelMemberParams },
      responses: ok(z.array(ChannelMember)),
    }),
    async (c) => {
      const { channel, name } = c.req.valid("param")
      return c.json(await addChannelMember(c.var.db, c.var.member, channel, name), 200)
    },
  )
  .openapi(
    operation({
      method: "delete",
      path: "/api/channels/{channel}/members/{name}",
      operationId: "removeChannelMember",
      tags,
      summary: "Remove a listed member from a channel; they stop seeing it at once. Removing one not listed changes nothing.",
      request: { params: ChannelMemberParams },
      responses: ok(z.array(ChannelMember)),
    }),
    async (c) => {
      const { channel, name } = c.req.valid("param")
      return c.json(await removeChannelMember(c.var.db, c.var.member, channel, name), 200)
    },
  )
