import { describe, expect, test } from "bun:test"
import { CreatedKey, memberHeader } from "@flockr/contracts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { createApp } from "../src/app"
import { liveViewer } from "../src/auth/identity"
import { createKey } from "../src/board/keys"
import { logEmail } from "../src/email/log"
import { resetBoard, seedBoard } from "../src/seed/seed"
import { freshBoard, testConnection } from "./harness"

const Me = z.object({ name: z.string(), via: z.string(), channels: z.array(z.string()).nullable() })
const origin = "http://localhost"
const liveUrl = new URL("http://localhost/ws")

async function signInBoard() {
  const connection = await testConnection()
  await resetBoard(connection.db)
  await seedBoard(connection.db)
  const mail: string[] = []
  const people = new Map([
    ["rosa@example.com", "rosa"],
    ["tim@example.com", "tim"],
  ])
  const app = createApp(connection.db, { auth: { mode: "on", people, secret: "test-secret-for-the-sign-in-tests-only", baseURL: origin, email: logEmail((line) => mail.push(line)) } })
  const call = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    const response = await app.request(path, {
      method: init.method ?? "GET",
      headers: { origin, ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    const text = await response.text()
    const json: unknown = text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null
    return { status: response.status, json, response }
  }
  const requestLink = (email: string) => call("/api/auth/sign-in/magic-link", { method: "POST", body: { email, callbackURL: "/" } })
  const linkIn = (line: string | undefined) => {
    const url = /http\S+/.exec(line ?? "")?.[0]
    if (!url) throw new Error(`No link in ${line}`)
    return new URL(url)
  }
  const signIn = async (email: string) => {
    await requestLink(email)
    const link = linkIn(mail.at(-1))
    const visit = await call(`${link.pathname}${link.search}`)
    const cookie = visit.response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
    return { visit, cookie, link }
  }
  const key = async (member: string, channels: string[] | null = null) => CreatedKey.parse(await createKey(connection.db, "simon", { member, channels })).secret
  return { app, db: connection.db, mail, call, requestLink, linkIn, signIn, key }
}

describe("sign-in (1d)", () => {
  test("an address not on the list gets the same answer, no email and no session", async () => {
    const board = await signInBoard()
    const outsider = await board.requestLink("eve@example.com")
    const insider = await board.requestLink("rosa@example.com")
    expect(outsider.status).toBe(200)
    expect(outsider.json).toEqual(insider.json)
    expect(board.mail).toHaveLength(1)
    expect(board.mail[0]).toContain("rosa@example.com")
    const pending = await board.db.execute(sql`select value from auth_verifications`)
    expect(pending.map((row) => String(row.value)).some((value) => value.includes("eve@example.com"))).toBe(false)
    const users = await board.db.execute(sql`select email from auth_users where email = 'eve@example.com'`)
    expect(users).toHaveLength(0)
  })

  test("a magic link signs in once, as the member the list names, creating that person", async () => {
    const board = await signInBoard()
    const first = await board.signIn("rosa@example.com")
    expect(first.visit.status).toBe(302)
    expect(first.cookie).toContain("flockr.session_token=")
    const me = await board.call("/api/me", { headers: { cookie: first.cookie } })
    expect(me.status).toBe(200)
    expect(Me.parse(me.json)).toMatchObject({ name: "rosa", via: "session" })
    const members = await board.call("/api/members", { headers: { cookie: first.cookie } })
    expect(z.array(z.object({ name: z.string(), kind: z.string() })).parse(members.json)).toContainEqual({ name: "rosa", kind: "person" })

    const again = await board.call(`${first.link.pathname}${first.link.search}`)
    expect(again.response.headers.get("location")).toContain("error=INVALID_TOKEN")
    expect(again.response.headers.getSetCookie().some((c) => c.startsWith("flockr.session_token=") && !c.includes("Max-Age=0"))).toBe(false)

    const out = await board.call("/api/auth/sign-out", { method: "POST", headers: { cookie: first.cookie } })
    expect(out.status).toBe(200)
    expect((await board.call("/api/me", { headers: { cookie: first.cookie } })).status).toBe(401)
  })

  test("with sign-in on the header is ignored and a request with no session or key is 401", async () => {
    const board = await signInBoard()
    expect((await board.call("/api/me")).status).toBe(401)
    expect((await board.call("/api/me", { headers: { [memberHeader]: "simon" } })).status).toBe(401)
    expect((await board.call("/api/channels/backend/messages", { method: "POST", headers: { [memberHeader]: "simon" }, body: { text: "hi" } })).status).toBe(401)
    expect((await board.call("/mcp", { method: "POST", headers: { [memberHeader]: "simon" }, body: {} })).status).toBe(401)
    expect((await board.call("/api/openapi.json")).status).toBe(200)

    const { cookie } = await board.signIn("tim@example.com")
    expect(Me.parse((await board.call("/api/me", { headers: { cookie, [memberHeader]: "simon" } })).json).name).toBe("tim")
    expect(Me.parse((await board.call("/api/me", { headers: { cookie, [memberHeader]: "claude" } })).json).name).toBe("tim")
    expect(Me.parse((await board.call("/api/me", { headers: { cookie, [memberHeader]: "gemini" } })).json).name).toBe("gemini")
    expect(await liveViewer(board.app.authenticator, { headers: new Headers({ [memberHeader]: "simon" }), url: liveUrl })).toMatchObject({ status: 401 })
    expect(await liveViewer(board.app.authenticator, { headers: new Headers({ cookie }), url: liveUrl })).toEqual({ member: "tim", channels: null })
  })
})

describe("member keys (3c)", () => {
  test("a key acts as its member, on the API, MCP and the live feed", async () => {
    const board = await signInBoard()
    const secret = await board.key("claude")
    const bearer = { authorization: `Bearer ${secret}` }
    expect(Me.parse((await board.call("/api/me", { headers: { ...bearer, [memberHeader]: "tim" } })).json)).toMatchObject({ name: "claude", via: "key", channels: null })
    const posted = await board.call("/api/channels/backend/messages", { method: "POST", headers: bearer, body: { text: "From a key" } })
    expect(posted.status).toBe(200)
    expect(z.object({ message: z.object({ who: z.string() }) }).parse(posted.json).message.who).toBe("claude")
    expect(await liveViewer(board.app.authenticator, { headers: new Headers(bearer), url: liveUrl })).toEqual({ member: "claude", channels: null })

    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (input, init) => Promise.resolve(board.app.request(input instanceof Request ? input : String(input), init)),
      requestInit: { headers: bearer },
    })
    const client = new Client({ name: "test", version: "1.0.0" })
    await client.connect(transport)
    const whoami = await client.callTool({ name: "whoami", arguments: {} })
    expect(Me.parse(whoami.structuredContent).name).toBe("claude")
    await client.close()
  })

  test("a revoked key is refused", async () => {
    const board = await signInBoard()
    const { cookie } = await board.signIn("tim@example.com")
    const made = await board.call("/api/keys", { method: "POST", headers: { cookie }, body: { member: "gemini" } })
    const created = CreatedKey.parse(made.json)
    expect(created.key).toMatchObject({ member: "gemini", owner: "tim", revokedAt: null })
    const bearer = { authorization: `Bearer ${created.secret}` }
    expect((await board.call("/api/me", { headers: bearer })).status).toBe(200)
    const listed = await board.call("/api/keys", { headers: { cookie } })
    expect(JSON.stringify(listed.json)).not.toContain(created.secret)

    expect((await board.call(`/api/keys/${created.key.id}/revoke`, { method: "POST", headers: { cookie } })).status).toBe(200)
    expect((await board.call(`/api/keys/${created.key.id}/revoke`, { method: "POST", headers: { cookie } })).status).toBe(200)
    expect((await board.call("/api/me", { headers: bearer })).status).toBe(401)
    expect(await liveViewer(board.app.authenticator, { headers: new Headers(bearer), url: liveUrl })).toMatchObject({ status: 401 })
    expect((await board.call("/api/keys", { method: "POST", headers: bearer, body: { member: "gemini" } })).status).toBe(401)
  })

  test("a key limited to channels works there and is refused everywhere else", async () => {
    const board = await signInBoard()
    const bearer = { authorization: `Bearer ${await board.key("codex", ["backend"])}` }
    expect((await board.call("/api/channels/backend/messages", { headers: bearer })).status).toBe(200)
    expect((await board.call("/api/channels/backend/messages", { method: "POST", headers: bearer, body: { text: "in scope" } })).status).toBe(200)
    expect((await board.call("/api/channels/platform/messages", { headers: bearer })).status).toBe(403)
    expect((await board.call("/api/channels/platform/messages", { method: "POST", headers: bearer, body: { text: "out of scope" } })).status).toBe(403)
    expect((await board.call("/api/tasks", { method: "POST", headers: bearer, body: { channel: "platform", title: "Out of scope" } })).status).toBe(403)
    expect((await board.call("/api/tasks?channel=backend", { headers: bearer })).status).toBe(200)
    expect((await board.call("/api/tasks", { headers: bearer })).status).toBe(403)
    expect((await board.call("/api/events", { headers: bearer })).status).toBe(403)
    expect((await board.call("/api/keys", { headers: bearer })).status).toBe(403)
    expect(await liveViewer(board.app.authenticator, { headers: new Headers(bearer), url: liveUrl })).toEqual({ member: "codex", channels: ["backend"] })

    const tasks = z.array(z.object({ id: z.number(), channel: z.string() })).parse((await board.call("/api/tasks?channel=backend", { headers: bearer })).json)
    const elsewhere = await board.db.execute(sql`select id from tasks where channel <> 'backend' limit 1`)
    const outside = z.object({ id: z.number() }).parse(elsewhere[0]).id
    expect((await board.call(`/api/tasks/${outside}`, { headers: bearer })).status).toBe(403)
    expect((await board.call(`/api/threads/${outside}`, { headers: bearer })).status).toBe(403)
    expect(tasks.every((task) => task.channel === "backend")).toBe(true)

    const claimed = z.object({ task: z.object({ channel: z.string() }).nullable() }).parse((await board.call("/api/tasks/claim", { method: "POST", headers: bearer, body: {} })).json)
    if (claimed.task) expect(claimed.task.channel).toBe("backend")
  })
})

describe("sign-in off (the default)", () => {
  test("the header names the member and keys are not needed", async () => {
    const { call } = await freshBoard()
    const me = await call("claude", "GET", "/api/me")
    expect(me.status).toBe(200)
    expect(me.json).toMatchObject({ name: "claude", auth: "off", via: "header" })
    expect((await call("simon", "POST", "/api/auth/sign-in/magic-link", { email: "rosa@example.com" })).status).toBe(403)
  })
})
