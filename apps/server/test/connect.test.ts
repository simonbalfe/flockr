import { describe, expect, test } from "bun:test"
import { LiveFrame, PostMessageResult, Task, WaitResult } from "@flockr/contracts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import { createApp } from "../src/app"
import { createKey, revokeKey } from "../src/board/keys"
import { viewerOf } from "../src/board/visibility"
import { waitForEvents } from "../src/board/wait"
import { logEmail } from "../src/email/log"
import { createHub } from "../src/live/hub"
import { postgresListener } from "../src/platform/postgres/live"
import { freshBoard } from "./harness"

const origin = "http://localhost"

async function connectBoard() {
  const board = await freshBoard()
  const { call } = board
  await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })
  await call("simon", "POST", "/api/orgs", { id: "globex", name: "Globex" })
  await call("simon", "POST", "/api/members", { name: "ana", kind: "person", org: "acme" })
  await call("simon", "POST", "/api/members", { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" })
  await call("simon", "POST", "/api/members", { name: "gus", kind: "person", org: "globex" })
  await call("simon", "POST", "/api/channels", { id: "acme-site", visibility: "shared" })
  await call("simon", "POST", "/api/channels", { id: "globex-app", visibility: "shared" })
  for (const name of ["ana", "acme-bot"]) await call("simon", "PUT", `/api/channels/acme-site/members/${name}`)
  await call("simon", "PUT", "/api/channels/globex-app/members/gus")
  const secured = createApp(board.db, { auth: { mode: "on", people: new Map([["simon@example.com", "simon"]]), secret: "test-secret-for-the-connect-tests-only", baseURL: origin, email: logEmail(() => undefined) } })
  const key = await createKey(board.db, "simon", { member: "acme-bot", channels: ["acme-site"] })
  const mcp = async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      fetch: (input, init) => Promise.resolve(secured.request(input instanceof Request ? input : String(input), init)),
      requestInit: { headers: { authorization: `Bearer ${key.secret}` } },
    })
    const client = new Client({ name: "acme-bot", version: "1.0.0" })
    await client.connect(transport)
    return client
  }
  return { ...board, secured, key, mcp }
}

const structured = <T extends z.ZodType>(schema: T, result: Awaited<ReturnType<Client["callTool"]>>) => schema.parse(result.structuredContent)

describe("connect any agent (11b)", () => {
  test("a client agent with a channel-limited key works a task with us over MCP only", async () => {
    const { call, mcp } = await connectBoard()
    const client = await mcp()
    const first = structured(WaitResult, await client.callTool({ name: "waitForEvents", arguments: { mentions: "yes", timeout: 0 } }))
    expect(first.timedOut).toBe(true)
    const task = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "acme-site", title: "Shrink the hero image" })).json)
    await call("simon", "POST", "/api/channels/acme-site/messages", { text: "@acme-bot can you take the hero task?" })
    const heard = structured(WaitResult, await client.callTool({ name: "waitForEvents", arguments: { mentions: "yes", since: first.cursor, timeout: 2 } }))
    expect(heard.events.map((e) => e.type)).toEqual(["message.posted"])
    const claimed = structured(z.object({ task: Task.nullable() }), await client.callTool({ name: "claimNextTask", arguments: {} }))
    expect(claimed.task?.id).toBe(task.id)
    const reply = await client.callTool({ name: "replyToThread", arguments: { id: String(task.id), text: "On it", epoch: claimed.task?.claimEpoch, key: "acme-bot-1" } })
    expect(reply.isError).toBeFalsy()
    const done = await client.callTool({ name: "completeTask", arguments: { id: task.id, epoch: claimed.task?.claimEpoch, note: "Hero is 40% smaller" } })
    expect(done.isError).toBeFalsy()
    const backend = await client.callTool({ name: "listMessages", arguments: { channel: "backend" } })
    expect(backend.isError).toBe(true)
    const tasks = await client.callTool({ name: "listTasks", arguments: { channel: "backend" } })
    expect(tasks.isError).toBe(true)
    await client.close()
  })

  test("wait returns a match at once, times out with a cursor past what it cannot see, and never the caller's own events", async () => {
    const { call, db } = await connectBoard()
    const ana = viewerOf("ana")
    const start = await waitForEvents(db, ana, { mentions: "no", timeout: 0 })
    await call("simon", "POST", "/api/channels/backend/messages", { text: "backend only" })
    await call("gus", "POST", "/api/channels/globex-app/messages", { text: "globex only" })
    await call("ana", "POST", "/api/channels/acme-site/messages", { text: "ana's own" })
    const quiet = await waitForEvents(db, ana, { since: start.cursor, mentions: "no", timeout: 0 })
    expect(quiet).toMatchObject({ events: [], timedOut: true })
    expect(quiet.cursor).toBeGreaterThan(start.cursor)
    await call("simon", "POST", "/api/channels/acme-site/messages", { text: "for acme" })
    const heard = await waitForEvents(db, ana, { since: quiet.cursor, mentions: "no", timeout: 0 })
    expect(heard.timedOut).toBe(false)
    expect(heard.events.every((e) => e.channel === "acme-site" && e.actor === "simon")).toBe(true)
    expect((await call("ana", "GET", "/api/wait?channel=backend&timeout=0")).status).toBe(403)
    const waiting = waitForEvents(db, ana, { since: heard.cursor, mentions: "yes", timeout: 5 })
    await call("simon", "POST", "/api/channels/acme-site/messages", { text: "@ana please look" })
    const woke = await waiting
    expect(woke.events.map((e) => e.data["mentions"])).toEqual([["ana"]])
  })

  test("a repeated post with the same key is stored once; new text under a used key is refused", async () => {
    const { call, db } = await connectBoard()
    const body = { text: "Deployed the preview", key: "run-41" }
    const first = PostMessageResult.parse((await call("acme-bot", "POST", "/api/channels/acme-site/messages", body)).json)
    const again = PostMessageResult.parse((await call("acme-bot", "POST", "/api/channels/acme-site/messages", body)).json)
    expect(again.message.id).toBe(first.message.id)
    expect((await call("acme-bot", "POST", "/api/channels/acme-site/messages", { text: "Something else", key: "run-41" })).status).toBe(409)
    expect((await call("ana", "POST", "/api/channels/acme-site/messages", body)).status).toBe(200)
    const posted = await waitForEvents(db, viewerOf("simon"), { since: 0, channel: "acme-site", mentions: "no", timeout: 0 })
    expect(posted.events.filter((e) => e.type === "message.posted" && e.actor === "acme-bot")).toHaveLength(1)
  })

  test("every event says the actor's org and kind, so runners can tell another org's agent", async () => {
    const { call, db } = await connectBoard()
    await call("acme-bot", "POST", "/api/channels/acme-site/messages", { text: "@claude hello" })
    const [event] = (await waitForEvents(db, viewerOf("simon"), { since: 0, channel: "acme-site", mentions: "yes", timeout: 0 })).events
    expect(event).toBeUndefined()
    const all = await waitForEvents(db, viewerOf("claude"), { since: 0, channel: "acme-site", mentions: "yes", timeout: 0 })
    expect(all.events[0]?.data).toMatchObject({ actorOrg: "acme", actorKind: "agent", mentions: ["claude"] })
  })

  test("a live socket closes when its key is revoked", async () => {
    const { call, connection, db, key } = await connectBoard()
    const hub = createHub(connection.db, postgresListener(connection.sql))
    await hub.ready
    const frames: LiveFrame[] = []
    let closed = false
    await hub.attach({ send: (text) => void frames.push(LiveFrame.parse(JSON.parse(text))), close: () => void (closed = true) }, null, { ...viewerOf("acme-bot", ["acme-site"]), key: { id: key.key.id, version: 0 } })
    await revokeKey(db, "simon", key.key.id)
    await call("simon", "POST", "/api/channels/acme-site/messages", { text: "after the revoke" })
    const deadline = Date.now() + 5000
    while (!closed && Date.now() < deadline) await Bun.sleep(25)
    await hub.close()
    expect(closed).toBe(true)
    expect(JSON.stringify(frames)).not.toContain("after the revoke")
  })
})
