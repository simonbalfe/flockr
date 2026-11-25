import { ChannelParams, DeletedMessage, EditMessageBody, FeedItem, ListMessagesQuery, MessageParams, MessageState, MessageVersions, PostMessageBody, PostMessageResult } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { deleteMessage, editMessage, postMessage } from "../board/messages"
import { getMessageVersions, listFeed } from "../board/read"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["messages"]

export const messageRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/messages",
      operationId: "listMessages",
      tags,
      summary: "Read a channel: messages, task cards, question cards and events, oldest first. With label, only messages carrying it and task cards whose task carries it",
      request: { params: ChannelParams, query: ListMessagesQuery },
      responses: ok(z.array(FeedItem)),
    }),
    async (c) => c.json(await listFeed(c.var.db, c.req.valid("param").channel, c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/messages",
      operationId: "postMessage",
      tags,
      summary: "Post a message to a channel, optionally with labels. Mentioning a member (@name) starts a conversation with it, never a task.",
      request: { params: ChannelParams, body: jsonBody(PostMessageBody) },
      responses: ok(PostMessageResult),
    }),
    async (c) => c.json(await postMessage(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/messages/{id}",
      operationId: "editMessage",
      tags,
      summary:
        "Edit a message or reply (m12): new text (author only; a message.edited event, the old text stays readable in listMessageVersions, mentions are read again) or its full set of labels (author, the author's owner or a person; a message.labeled event). Sending what it already has changes nothing.",
      request: { params: MessageParams, body: jsonBody(EditMessageBody) },
      responses: ok(MessageState),
    }),
    async (c) => c.json(await editMessage(c.var.db, c.var.member, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/messages/{id}/versions",
      operationId: "listMessageVersions",
      tags,
      summary: "Every version of a message or reply's text (m12), oldest first, the current one last; empty once it is deleted",
      request: { params: MessageParams },
      responses: ok(MessageVersions),
    }),
    async (c) => c.json(await getMessageVersions(c.var.db, c.req.valid("param").id), 200),
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
