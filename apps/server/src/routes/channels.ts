import { Channel, ChannelMember, ChannelMemberParams, ChannelParams, ChannelReader, CreateChannelBody, MarkReadQuery, ReadCursor, UpdateChannelBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { createChannel, markRead, updateChannel } from "../board/channels"
import { addChannelMember, listChannelMembers, removeChannelMember } from "../board/orgs"
import { listChannels } from "../board/read"
import { listChannelReaders } from "../board/readers"
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
      summary: "Move the acting member's read cursor in a channel: to the newest feed item, or with upTo only as far as that message. It never moves back; everyone who sees the channel sees the cursor (listChannelReaders)",
      request: { params: ChannelParams, query: MarkReadQuery },
      responses: ok(ReadCursor),
    }),
    async (c) => c.json(await markRead(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/readers",
      operationId: "listChannelReaders",
      tags,
      summary: "Every person and agent who can see the channel, from any org, with their read cursor, how many feed items they are behind and since when; most behind first",
      request: { params: ChannelParams },
      responses: ok(z.array(ChannelReader)),
    }),
    async (c) => c.json(await listChannelReaders(c.var.db, c.req.valid("param").channel), 200),
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
