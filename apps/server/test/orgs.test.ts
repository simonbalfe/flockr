import { describe, expect, test } from "bun:test"
import { Channel, ChannelMember, LiveFrame, Member, Org, PostMessageResult, Task } from "@flockr/contracts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { eventsSince } from "../src/board/events"
import { viewerOf } from "../src/board/visibility"
import { postgresListener } from "../src/platform/postgres/live"
import { createHub } from "../src/live/hub"
import { freshBoard } from "./harness"

const hidden = ["backend", "platform", "reviews", "errors"]
const leaks = (json: unknown) => {
  const text = JSON.stringify(json)
  return [...hidden.filter((channel) => text.includes(`"channel":"${channel}"`) || text.includes(`"id":"${channel}"`)), ...["gus", "globex"].filter((word) => text.includes(word))]
}

async function sharedBoard() {
  const board = await freshBoard()
  const { call } = board
  expect((await call("simon", "POST", "/api/orgs", { id: "acme", name: "Acme" })).status).toBe(200)
  expect((await call("simon", "POST", "/api/orgs", { id: "globex", name: "Globex" })).status).toBe(200)
  for (const member of [
    { name: "ana", kind: "person", org: "acme" },
    { name: "acme-bot", kind: "agent", org: "acme", owner: "ana" },
    { name: "gus", kind: "person", org: "globex" },
  ]) {
    expect((await call("simon", "POST", "/api/members", member)).status).toBe(200)
  }
  expect((await call("simon", "POST", "/api/channels", { id: "acme-site", topic: "Acme's landing page", visibility: "shared" })).status).toBe(200)
  expect((await call("simon", "POST", "/api/channels", { id: "globex-app", visibility: "shared" })).status).toBe(200)
  for (const name of ["ana", "acme-bot"]) expect((await call("simon", "PUT", `/api/channels/acme-site/members/${name}`)).status).toBe(200)
  expect((await call("simon", "PUT", "/api/channels/globex-app/members/gus")).status).toBe(200)
  const task = Task.parse((await call("simon", "POST", "/api/tasks", { channel: "acme-site", title: "Make the hero image smaller" })).json)
  await call("gus", "POST", "/api/channels/globex-app/messages", { text: "globex secret roadmap" })
  await call("simon", "POST", "/api/channels/backend/messages", { text: "backend secret plan" })
  const [backendTask] = z.array(z.object({ id: z.number() })).parse([...(await board.db.execute(sql`select id from tasks where channel = 'backend' order by id limit 1`))])
  if (!backendTask) throw new Error("The seed has no backend task")
  return { ...board, task, backendTask: backendTask.id }
}

describe("orgs and shared channels (11a)", () => {
  test("a client member sees only the channels shared with them, on every list", async () => {
    const { call } = await sharedBoard()
    const channels = z.array(Channel).parse((await call("ana", "GET", "/api/channels")).json)
    expect(channels.map((c) => c.id)).toEqual(["acme-site"])
    expect(channels[0]).toMatchObject({ org: "home", visibility: "shared", members: ["acme-bot", "ana"] })
    const paths = ["/api/channels", "/api/members", "/api/orgs", "/api/tasks", "/api/plans", "/api/search?q=secret", "/api/focus", "/api/inbox", "/api/activity", "/api/events?since=0", "/api/me/threads", "/api/me/sent", "/api/me/saved", "/api/me/drafts"]
    for (const path of paths) {
      const response = await call("ana", "GET", path)
      expect({ path, status: response.status }).toEqual({ path, status: 200 })
      expect({ path, leaks: leaks(response.json) }).toEqual({ path, leaks: [] })
    }
    const orgs = z.array(Org).parse((await call("ana", "GET", "/api/orgs")).json)
    expect(orgs.map((o) => o.id)).toEqual(["home", "acme"])
    const members = z.array(Member).parse((await call("ana", "GET", "/api/members")).json)
    expect(members.find((m) => m.name === "ana")).toMatchObject({ org: "acme" })
    expect(members.some((m) => m.name === "simon")).toBe(true)
    const simonSees = z.array(Channel).parse((await call("simon", "GET", "/api/channels")).json).map((c) => c.id)
    expect(simonSees).toEqual(expect.arrayContaining(["backend", "acme-site", "globex-app"]))
  })

  test("a route naming a channel, task, message or plan the member cannot see is refused", async () => {
    const { call, backendTask, db } = await sharedBoard()
    const [message] = z.array(z.object({ id: z.number() })).parse([...(await db.execute(sql`select id from messages where channel = 'backend' order by id limit 1`))])
    const [plan] = z.array(z.object({ id: z.number() })).parse([...(await db.execute(sql`select id from plans order by id limit 1`))])
    const refused: [string, string, unknown?][] = [
      ["GET", "/api/channels/backend/messages"],
      ["POST", "/api/channels/backend/messages", { text: "hello" }],
      ["GET", "/api/channels/backend/memory"],
      ["GET", "/api/channels/backend/areas"],
      ["GET", "/api/channels/globex-app/messages"],
      ["GET", `/api/tasks/${backendTask}`],
      ["GET", `/api/threads/${backendTask}`],
      ["POST", `/api/tasks/${backendTask}/claim`],
      ["GET", `/api/threads/m${message?.id}`],
      ["GET", `/api/messages/m${message?.id}/versions`],
      ["GET", `/api/plans/${plan?.id}`],
      ["POST", "/api/tasks", { channel: "backend", title: "Sneak in" }],
      ["GET", "/api/search?q=secret&channel=backend"],
    ]
    for (const [method, path, body] of refused) {
      expect({ method, path, status: (await call("ana", method, path, body)).status }).toEqual({ method, path, status: 403 })
    }
  })

  test("board-wide routes belong to the org that runs the board", async () => {
    const { call } = await sharedBoard()
    const boardWide: [string, string, unknown?][] = [
      ["GET", "/api/agents"],
      ["GET", "/api/agents/claude"],
      ["GET", "/api/agents/claude/notes"],
      ["GET", "/api/agents/claude/sessions"],
      ["GET", "/api/agents/claude/activity"],
      ["GET", "/api/machines"],
      ["GET", "/api/keys"],
      ["GET", "/api/routines"],
      ["GET", "/api/approval-rules"],
      ["GET", "/api/brief"],
      ["POST", "/api/orgs", { id: "initech", name: "Initech" }],
      ["POST", "/api/channels", { id: "acme-own" }],
      ["POST", "/api/members", { name: "acme-two", kind: "agent", org: "acme", owner: "ana" }],
    ]
    for (const [method, path, body] of boardWide) {
      expect({ method, path, status: (await call("ana", method, path, body)).status }).toEqual({ method, path, status: 403 })
    }
  })

  test("in a shared channel both orgs work one task with claims as usual", async () => {
    const { call, task } = await sharedBoard()
    expect((await call("ana", "GET", `/api/tasks/${task.id}`)).status).toBe(200)
    const claimed = z.object({ task: Task.nullable() }).parse((await call("acme-bot", "POST", "/api/tasks/claim", {})).json)
    expect(claimed.task?.id).toBe(task.id)
    expect((await call("ana", "POST", `/api/threads/${task.id}/replies`, { text: "Thanks @acme-bot" })).status).toBe(200)
  })

  test("the live socket and its catch-up carry only what the viewer can see", async () => {
    const { call, connection, db } = await sharedBoard()
    const forAna = await eventsSince(db, 0, 1000, { kind: "live", viewer: viewerOf("ana") })
    expect(forAna.length).toBeGreaterThan(0)
    expect(forAna.every((event) => event.channel === "acme-site")).toBe(true)
    expect(leaks(forAna)).toEqual([])

    expect((await call("simon", "POST", "/api/channels", { id: "founders", visibility: "private" })).status).toBe(200)
    await call("simon", "POST", "/api/channels/founders/messages", { text: "private founders note" })
    const forTim = await eventsSince(db, 0, 1000, { kind: "live", viewer: viewerOf("tim") })
    const stub = forTim.find((event) => event.channel === "founders" && event.type === "message.posted")
    expect(stub?.data).toEqual({ mentions: [] })
    expect(JSON.stringify(forTim)).not.toContain("founders note")
    expect((await eventsSince(db, 0, 1000, { kind: "live", viewer: viewerOf("ana") })).some((event) => event.channel === "founders")).toBe(false)
    expect((await eventsSince(db, 0, 1000, { kind: "live", viewer: viewerOf("simon", ["acme-site"]) })).every((event) => event.channel === "acme-site")).toBe(true)

    const hub = createHub(connection.db, postgresListener(connection.sql))
    await hub.ready
    const frames: LiveFrame[] = []
    await hub.attach({ send: (text: string) => void frames.push(LiveFrame.parse(JSON.parse(text))) }, 0, viewerOf("ana"))
    await call("simon", "POST", "/api/channels/backend/messages", { text: "later backend note" })
    await call("simon", "POST", "/api/channels/acme-site/messages", { text: "later acme note" })
    const deadline = Date.now() + 5000
    const said = () => frames.flatMap((f) => (f.kind === "event" && f.event.type === "message.posted" ? [JSON.stringify(f.event.data)] : []))
    while (!said().some((text) => text.includes("later acme note")) && Date.now() < deadline) await Bun.sleep(25)
    await hub.close()
    const events = frames.flatMap((f) => (f.kind === "event" ? [f.event] : []))
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.channel === "acme-site")).toBe(true)
    expect(JSON.stringify(frames)).not.toContain("backend note")
  })

  test("MCP tools called as a client member return only shared channels", async () => {
    const { app } = await sharedBoard()
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp?as=ana"), {
      fetch: (input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init)),
      requestInit: { headers: { "x-flockr-member": "ana" } },
    })
    const client = new Client({ name: "test", version: "1.0.0" })
    await client.connect(transport)
    const tasks = await client.callTool({ name: "listTasks", arguments: {} })
    const search = await client.callTool({ name: "searchBoard", arguments: { q: "secret" } })
    const backend = await client.callTool({ name: "listMessages", arguments: { channel: "backend" } })
    await client.close()
    expect(leaks(tasks.content)).toEqual([])
    expect(JSON.stringify(tasks.content)).toContain("acme-site")
    expect(leaks(search.content)).toEqual([])
    expect(backend.isError).toBe(true)
  })

  test("writes only name members who can see the channel", async () => {
    const { call, task } = await sharedBoard()
    const posted = PostMessageResult.parse((await call("ana", "POST", "/api/channels/acme-site/messages", { text: "@gus @simon @acme-bot look" })).json)
    expect(posted.message.mentions).toEqual(["simon", "acme-bot"])
    expect((await call("simon", "POST", `/api/tasks/${task.id}/give`, { to: "gus" })).status).toBe(400)
    expect((await call("simon", "POST", "/api/tasks", { channel: "acme-site", title: "For gus", assignee: "gus" })).status).toBe(400)
    expect((await call("ana", "POST", "/api/dms", { with: "gus" })).status).toBe(404)
    expect((await call("ana", "POST", "/api/dms", { with: "simon" })).status).toBe(200)
    expect((await call("simon", "PUT", "/api/channels/backend/members/gus")).status).toBe(400)
    expect((await call("simon", "POST", "/api/members", { name: "acme-three", kind: "agent", org: "acme", owner: "simon" })).status).toBe(400)
  })

  test("sharing is a setting per channel, and a channel with outside members stays shared", async () => {
    const { call } = await sharedBoard()
    expect((await call("ana", "PUT", "/api/channels/acme-site/members/gus")).status).toBe(403)
    expect((await call("simon", "PATCH", "/api/channels/acme-site", { visibility: "org" })).status).toBe(400)
    const before = z.array(ChannelMember).parse((await call("simon", "GET", "/api/channels/acme-site/members")).json)
    expect(before.map((m) => [m.member, m.org])).toEqual([
      ["ana", "acme"],
      ["acme-bot", "acme"],
    ])
    expect((await call("simon", "PUT", "/api/channels/acme-site/members/ana")).status).toBe(200)
    for (const name of ["ana", "acme-bot"]) expect((await call("simon", "DELETE", `/api/channels/acme-site/members/${name}`)).status).toBe(200)
    expect((await call("ana", "GET", "/api/channels/acme-site/messages")).status).toBe(403)
    const changed = Channel.parse((await call("simon", "PATCH", "/api/channels/acme-site", { visibility: "org" })).json)
    expect(changed.visibility).toBe("org")
    expect(z.array(Channel).parse((await call("ana", "GET", "/api/channels")).json)).toEqual([])
  })
})
