import { ChannelParams, DeletedMessage, FeedItem, MessageParams, PostMessageBody, PostMessageResult } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { deleteMessage, postMessage } from "../board/messages"
import { listFeed } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["messages"]

export const messageRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/messages",
      operationId: "listMessages",
      tags,
      summary: "Read a channel: messages, task cards, question cards and events, oldest first",
      request: { params: ChannelParams },
      responses: ok(z.array(FeedItem)),
    }),
    async (c) => c.json(await listFeed(c.var.db, c.req.valid("param").channel), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/messages",
      operationId: "postMessage",
      tags,
      summary: "Post a message to a channel. A person mentioning an agent (@name) also makes a task for that agent.",
      request: { params: ChannelParams, body: jsonBody(PostMessageBody) },
      responses: ok(PostMessageResult),
    }),
    async (c) => c.json(await postMessage(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json").text), 200),
  )
  .openapi(
    operation({
      method: "delete",
      path: "/api/messages/{id}",
      operationId: "deleteMessage",
      tags,
      summary: "Delete a message or reply (m12). Its author, the author's owner or a person can. The text is removed from every read; repeating it changes nothing.",
      request: { params: MessageParams },
      responses: ok(DeletedMessage),
    }),
    async (c) => c.json(await deleteMessage(c.var.db, c.var.member, c.req.valid("param").id), 200),
  )
