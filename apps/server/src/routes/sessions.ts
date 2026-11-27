import { AgentParams, OpenSessionBody, SaveChunkBody, SaveChunkResult, SavedSession, SessionChunk, SessionChunkParams, SessionListQuery, SessionParams, SessionSummary } from "@flockr/contracts"
import { z } from "@hono/zod-openapi"
import { getSession, listSessions, openSession, readChunk, saveChunk, type SessionStore } from "../board/sessions"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["saved sessions"]

export const sessionRoutes = (store: SessionStore) =>
  router()
    .openapi(
      operation({
        method: "get",
        path: "/api/agents/{name}/sessions",
        operationId: "listSavedSessions",
        tags,
        summary: "A worker's saved sessions, most recently saved first: each one's fence, turns and size. Only that agent and people may read them; thread= keeps the sessions of one thread",
        request: { params: AgentParams, query: SessionListQuery },
        responses: ok(z.array(SessionSummary)),
      }),
      async (c) => c.json(await listSessions(c.var.db, c.var.member, c.req.valid("param").name, c.req.valid("query")), 200),
    )
    .openapi(
      operation({
        method: "get",
        path: "/api/agents/{name}/sessions/{session}",
        operationId: "getSavedSession",
        tags,
        summary: "One saved session with every chunk in turn order: the list a restore reads. A chunk uploaded but never added here is ignored",
        request: { params: SessionParams },
        responses: ok(SavedSession),
      }),
      async (c) => {
        const { name, session } = c.req.valid("param")
        return c.json(await getSession(c.var.db, c.var.member, name, session), 200)
      },
    )
    .openapi(
      operation({
        method: "post",
        path: "/api/agents/{name}/sessions/{session}/open",
        operationId: "openSavedSession",
        tags,
        summary: "Start or restore a session before saving to it; only the agent itself. With a claim it is fenced by that claim's epoch; without one the session epoch goes up by one, so an older worker's saves are refused. Returns the chunks to restore",
        request: { params: SessionParams, body: jsonBody(OpenSessionBody) },
        responses: ok(SavedSession),
      }),
      async (c) => {
        const { name, session } = c.req.valid("param")
        return c.json(await openSession(c.var.db, c.var.member, name, session, c.req.valid("json")), 200)
      },
    )
    .openapi(
      operation({
        method: "post",
        path: "/api/agents/{name}/sessions/{session}/chunks",
        operationId: "saveSessionChunk",
        tags,
        summary: "Save one turn's new steps as a chunk; only the agent itself, under the session's current fence (a stale fence is refused). Sending the same chunk again changes nothing; other content for a saved turn is refused",
        request: { params: SessionParams, body: jsonBody(SaveChunkBody) },
        responses: ok(SaveChunkResult),
      }),
      async (c) => {
        const { name, session } = c.req.valid("param")
        return c.json(await saveChunk(c.var.db, store, { actor: c.var.member, agent: name, session, body: c.req.valid("json") }), 200)
      },
    )
    .openapi(
      operation({
        method: "get",
        path: "/api/agents/{name}/sessions/{session}/chunks/{turn}",
        operationId: "readSessionChunk",
        tags,
        summary: "One saved chunk, base64, as the pointer lists it; only that agent and people may read it",
        request: { params: SessionChunkParams },
        responses: ok(SessionChunk),
      }),
      async (c) => {
        const { name, session, turn } = c.req.valid("param")
        return c.json(await readChunk(c.var.db, store, { actor: c.var.member, agent: name, session, turn }), 200)
      },
    )
