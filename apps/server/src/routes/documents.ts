import { ChannelDocument, ChannelParams, DocumentQuery, DocumentVersion, EditDocumentBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { editChannelDocument, getChannelDocument, listDocumentVersions } from "../board/documents"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["channel document"]

export const documentRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/document",
      operationId: "getChannelDocument",
      tags,
      summary: "The channel's living document: its current plan and shared notes, read first by every member. Version 0 and empty before the first edit; ?version=N reads an earlier one",
      request: { params: ChannelParams, query: DocumentQuery },
      responses: ok(ChannelDocument),
    }),
    async (c) => c.json(await getChannelDocument(c.var.db, c.req.valid("param").channel, c.req.valid("query").version), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/channels/{channel}/document",
      operationId: "editChannelDocument",
      tags,
      summary:
        "Replace the channel's document with new text, naming the version you read as replaces. If someone edited it since, the edit is refused with 409 stale_version: read it and edit again. A retry of your own edit writes nothing; every version stays readable",
      request: { params: ChannelParams, body: jsonBody(EditDocumentBody) },
      responses: ok(ChannelDocument),
    }),
    async (c) => c.json(await editChannelDocument(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/document/versions",
      operationId: "listDocumentVersions",
      tags,
      summary: "Every version of the channel's document, newest first: who, when, why and how long. Read one with getChannelDocument ?version=",
      request: { params: ChannelParams },
      responses: ok(z.array(DocumentVersion)),
    }),
    async (c) => c.json(await listDocumentVersions(c.var.db, c.req.valid("param").channel), 200),
  )
