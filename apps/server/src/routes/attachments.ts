import { ChannelParams, FileContent, FileParams, FileRef, Reaction, ReactionParams, UploadFileBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { fileBytes, fileContent, findFile, setReaction, uploadFile } from "../board/attachments"
import { presentFile } from "../board/read"
import type { ObjectStore } from "../storage/store"
import { errors, jsonBody, ok, operation, router } from "./shared"

const reactionTags: [string] = ["messages"]
const fileTags: [string] = ["files"]

export const attachmentRoutes = (store: ObjectStore | null) =>
  router()
    .openapi(
      operation({
        method: "put",
        path: "/api/messages/{id}/reactions/{reaction}",
        operationId: "addReaction",
        tags: reactionTags,
        summary: "React to a message or reply with one of +1, -1, eyes, check, heart, question. Reacting the same way twice changes nothing. Returns the message's reactions",
        request: { params: ReactionParams },
        responses: ok(z.array(Reaction)),
      }),
      async (c) => {
        const { id, reaction } = c.req.valid("param")
        return c.json(await setReaction(c.var.db, c.var.member, id, reaction, true), 200)
      },
    )
    .openapi(
      operation({
        method: "delete",
        path: "/api/messages/{id}/reactions/{reaction}",
        operationId: "removeReaction",
        tags: reactionTags,
        summary: "Take back your reaction; safe to repeat. Returns the message's reactions",
        request: { params: ReactionParams },
        responses: ok(z.array(Reaction)),
      }),
      async (c) => {
        const { id, reaction } = c.req.valid("param")
        return c.json(await setReaction(c.var.db, c.var.member, id, reaction, false), 200)
      },
    )
    .openapi(
      operation({
        method: "post",
        path: "/api/channels/{channel}/files",
        operationId: "uploadFile",
        tags: fileTags,
        summary: "Upload a file to a channel as base64 (at most 5 MB). Attach it by id with files on postMessage or replyToThread; only people who can see the channel can read it",
        request: { params: ChannelParams, body: jsonBody(UploadFileBody) },
        responses: ok(FileRef),
      }),
      async (c) => c.json(await uploadFile(c.var.db, store, c.var.member, c.req.valid("param").channel, c.req.valid("json")), 200),
    )
    .openapi(
      operation({
        method: "get",
        path: "/api/files/{id}",
        operationId: "getFile",
        tags: fileTags,
        summary: "A file's name, type, size, channel and the message it is attached to",
        request: { params: FileParams },
        responses: ok(FileRef),
      }),
      async (c) => c.json(presentFile(await findFile(c.var.db, c.req.valid("param").id)), 200),
    )
    .openapi(
      operation({
        method: "get",
        path: "/api/files/{id}/content",
        operationId: "getFileContent",
        tags: fileTags,
        summary: "A file with its bytes as base64, for agents and MCP clients",
        request: { params: FileParams },
        responses: ok(FileContent),
      }),
      async (c) => c.json(await fileContent(c.var.db, store, c.req.valid("param").id), 200),
    )
    .openapi(
      operation({
        method: "get",
        path: "/api/files/{id}/raw",
        operationId: "downloadFile",
        tags: fileTags,
        summary: "The file's bytes with its content type, for a browser link or a download",
        request: { params: FileParams },
        responses: { 200: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } }, description: "The file" }, ...errors },
      }),
      async (c) => {
        const { row, bytes } = await fileBytes(c.var.db, store, c.req.valid("param").id)
        return c.body(new Uint8Array(bytes), 200, { "content-type": row.contentType, "content-disposition": `inline; filename="${encodeURIComponent(row.name)}"` })
      },
    )
