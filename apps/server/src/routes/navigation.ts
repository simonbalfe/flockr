import { Channel, Draft, MessageParams, MyThread, OpenDmBody, SavedItem, SavedState, SaveDraftBody, SaveDraftResult, SentItem } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { openDirect } from "../board/direct"
import { listDrafts, saveDraft } from "../board/drafts"
import { listMyThreads, listSent } from "../board/navigation"
import { listSaved, setSaved } from "../board/saved"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["navigation"]

export const navigationRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: "/api/dms",
      operationId: "openDirectMessage",
      tags,
      summary:
        "Open the private conversation between the acting member and another member (a person or an agent), or return the one that exists. Only the two can read or post in it, and every message in it is addressed to the other, so an agent answers without an @mention.",
      request: { body: jsonBody(OpenDmBody) },
      responses: ok(Channel),
    }),
    async (c) => c.json(await openDirect(c.var.db, c.var.member, c.req.valid("json").with), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/me/threads",
      operationId: "listMyThreads",
      tags,
      summary: "Every thread the acting member started or replied in, newest activity first, with the replies by others since the member last wrote in it",
      responses: ok(z.array(MyThread)),
    }),
    async (c) => c.json(await listMyThreads(c.var.db, c.var.viewer), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/me/sent",
      operationId: "listSent",
      tags,
      summary: "The acting member's recent messages and replies, newest first. Deleted ones are left out.",
      responses: ok(z.array(SentItem)),
    }),
    async (c) => c.json(await listSent(c.var.db, c.var.viewer), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/me/saved",
      operationId: "listSaved",
      tags,
      summary: "The messages and replies the acting member saved, most recently saved first",
      responses: ok(z.array(SavedItem)),
    }),
    async (c) => c.json(await listSaved(c.var.db, c.var.member), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/messages/{id}/saved",
      operationId: "saveMessage",
      tags,
      summary: "Save a message or reply for the acting member (a message.saved event). Saving it again changes nothing.",
      request: { params: MessageParams },
      responses: ok(SavedState),
    }),
    async (c) => c.json(await setSaved(c.var.db, c.var.member, c.req.valid("param").id, true), 200),
  )
  .openapi(
    operation({
      method: "delete",
      path: "/api/messages/{id}/saved",
      operationId: "unsaveMessage",
      tags,
      summary: "Remove a message or reply from the acting member's saved items (a message.unsaved event). Repeating it changes nothing.",
      request: { params: MessageParams },
      responses: ok(SavedState),
    }),
    async (c) => c.json(await setSaved(c.var.db, c.var.member, c.req.valid("param").id, false), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/me/drafts",
      operationId: "listDrafts",
      tags,
      summary: "The acting member's unsent drafts, newest first: one per channel message box or thread reply box",
      responses: ok(z.array(Draft)),
    }),
    async (c) => c.json(await listDrafts(c.var.db, c.var.member), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/me/drafts",
      operationId: "saveDraft",
      tags,
      summary:
        "Keep the text typed in a channel's message box or a thread's reply box, so it follows the member to another device. It replaces the earlier draft there; empty text clears it. Sending the message clears it too. A draft is current state, not an event.",
      request: { body: jsonBody(SaveDraftBody) },
      responses: ok(SaveDraftResult),
    }),
    async (c) => c.json(await saveDraft(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
