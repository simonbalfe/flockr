import { AddMemoryBody, AgentNoteParams, AgentParams, ChannelMemoryParams, ChannelParams, MemoryItem, MemoryListQuery, UpdateMemoryBody } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { addMemory, agentNotes, channelMemory, listMemory, setMemoryArchived, updateMemory } from "../board/memory"
import { jsonBody, ok, operation, router } from "./shared"

const noteTags: [string] = ["agent notes"]
const memoryTags: [string] = ["channel memory"]

export const memoryRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/agents/{name}/notes",
      operationId: "listAgentNotes",
      tags: noteTags,
      summary: "An agent's notes, newest first. Only that agent and people may read them; page with before. state=archived lists the archived ones",
      request: { params: AgentParams, query: MemoryListQuery },
      responses: ok(z.array(MemoryItem)),
    }),
    async (c) => c.json(await listMemory(c.var.db, c.var.member, agentNotes(c.req.valid("param").name), c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/agents/{name}/notes",
      operationId: "addAgentNote",
      tags: noteTags,
      summary: "Save a short note an agent keeps across conversations (a decision, preference, fact or to do), optionally linked to the thread it came from. Send a key so a retry changes nothing twice; an agent keeps at most 100 live notes",
      request: { params: AgentParams, body: jsonBody(AddMemoryBody) },
      responses: ok(MemoryItem),
    }),
    async (c) => c.json(await addMemory(c.var.db, c.var.member, agentNotes(c.req.valid("param").name), c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/agents/{name}/notes/{id}",
      operationId: "updateAgentNote",
      tags: noteTags,
      summary: "Edit a note's text, kind, tags or source thread; the edit is a new event and an unchanged note writes nothing",
      request: { params: AgentNoteParams, body: jsonBody(UpdateMemoryBody) },
      responses: ok(MemoryItem),
    }),
    async (c) => {
      const { name, id } = c.req.valid("param")
      return c.json(await updateMemory(c.var.db, c.var.member, agentNotes(name), id, c.req.valid("json")), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/agents/{name}/notes/{id}/archive",
      operationId: "archiveAgentNote",
      tags: noteTags,
      summary: "Archive a note: it leaves the agent's lists and prompts but stays readable and can be restored; safe to repeat",
      request: { params: AgentNoteParams },
      responses: ok(MemoryItem),
    }),
    async (c) => {
      const { name, id } = c.req.valid("param")
      return c.json(await setMemoryArchived(c.var.db, c.var.member, agentNotes(name), id, true), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/agents/{name}/notes/{id}/restore",
      operationId: "restoreAgentNote",
      tags: noteTags,
      summary: "Bring an archived note back; safe to repeat",
      request: { params: AgentNoteParams },
      responses: ok(MemoryItem),
    }),
    async (c) => {
      const { name, id } = c.req.valid("param")
      return c.json(await setMemoryArchived(c.var.db, c.var.member, agentNotes(name), id, false), 200)
    },
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/channels/{channel}/memory",
      operationId: "listChannelMemory",
      tags: memoryTags,
      summary: "The decisions and facts a channel keeps, newest first; every agent working in the channel reads them first. state=archived lists the archived ones",
      request: { params: ChannelParams, query: MemoryListQuery },
      responses: ok(z.array(MemoryItem)),
    }),
    async (c) => c.json(await listMemory(c.var.db, c.var.member, channelMemory(c.req.valid("param").channel), c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/memory",
      operationId: "addChannelMemory",
      tags: memoryTags,
      summary: "Add a decision, fact or preference to a channel's memory, optionally linked to its thread. Any member may add; send a key so a retry changes nothing twice; a channel keeps at most 100 live items",
      request: { params: ChannelParams, body: jsonBody(AddMemoryBody) },
      responses: ok(MemoryItem),
    }),
    async (c) => c.json(await addMemory(c.var.db, c.var.member, channelMemory(c.req.valid("param").channel), c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "patch",
      path: "/api/channels/{channel}/memory/{id}",
      operationId: "updateChannelMemory",
      tags: memoryTags,
      summary: "Edit a channel memory item. A person may edit any; an agent only the ones it added. The edit is a new event",
      request: { params: ChannelMemoryParams, body: jsonBody(UpdateMemoryBody) },
      responses: ok(MemoryItem),
    }),
    async (c) => {
      const { channel, id } = c.req.valid("param")
      return c.json(await updateMemory(c.var.db, c.var.member, channelMemory(channel), id, c.req.valid("json")), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/memory/{id}/archive",
      operationId: "archiveChannelMemory",
      tags: memoryTags,
      summary: "Remove an item from a channel's memory (it stays readable and can be restored). A person may archive any; an agent only its own; safe to repeat",
      request: { params: ChannelMemoryParams },
      responses: ok(MemoryItem),
    }),
    async (c) => {
      const { channel, id } = c.req.valid("param")
      return c.json(await setMemoryArchived(c.var.db, c.var.member, channelMemory(channel), id, true), 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: "/api/channels/{channel}/memory/{id}/restore",
      operationId: "restoreChannelMemory",
      tags: memoryTags,
      summary: "Bring an archived channel memory item back; safe to repeat",
      request: { params: ChannelMemoryParams },
      responses: ok(MemoryItem),
    }),
    async (c) => {
      const { channel, id } = c.req.valid("param")
      return c.json(await setMemoryArchived(c.var.db, c.var.member, channelMemory(channel), id, false), 200)
    },
  )
