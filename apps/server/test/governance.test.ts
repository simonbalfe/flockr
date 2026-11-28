import { describe, expect, test } from "bun:test"
import { AuthorizeResult, channelsHeader, CreatedKey, DeviceDecision, DeviceRequest, MemberAccess, memberHeader, MemberKey, OAuthClient, RevokedKeys } from "@flockr/contracts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { classifiedOperations, mcpTransport, needOf, operationMatcher } from "../src/auth/access"
import { liveViewer } from "../src/auth/identity"
import { createKey } from "../src/board/keys"
import { stillLive } from "../src/board/visibility"
import { securedBoard } from "./harness"

const liveUrl = new URL("http://localhost/ws")
const Revoked = z.object({ cause: z.string(), member: z.string() })

async function revokeCauses(db: Awaited<ReturnType<typeof securedBoard>>["db"], member: string): Promise<string[]> {
  const rows = await db.execute(sql`select data from events where type = 'key.revoked' order by seq`)
  return rows.map((row) => Revoked.parse(row.data)).filter((data) => data.member === member).map((data) => data.cause)
}

describe("revoke every key (11f revoke-all)", () => {
  test("pausing a served agent turns off every key it has at once, and only its keys", async () => {
    const board = await securedBoard()
    expect((await board.call("simon", "POST", "/api/agents/lead/start")).status).toBe(200)
    const open = await board.key("lead")
    const limited = await board.key("lead", ["backend"])
    const other = await board.key("claude")
    expect((await board.bearer("/api/me", open)).status).toBe(200)
    expect((await board.bearer("/api/channels/backend/messages", limited)).status).toBe(200)

    expect((await board.call("simon", "POST", "/api/agents/lead/pause")).status).toBe(200)
    expect((await board.bearer("/api/me", open)).status).toBe(401)
    expect((await board.bearer("/api/channels/backend/messages", limited)).status).toBe(401)
    expect((await board.bearer("/mcp", open, { method: "POST", body: {} })).status).toBe(401)
    expect(await liveViewer(board.secured.authenticator, { headers: new Headers({ authorization: `Bearer ${open}` }), url: liveUrl })).toMatchObject({ status: 401 })
    expect((await board.bearer("/api/me", other)).status).toBe(200)
    expect(await revokeCauses(board.db, "lead")).toEqual(["pause", "pause"])

    expect((await board.call("simon", "POST", "/api/agents/lead/resume")).status).toBe(200)
    expect((await board.bearer("/api/me", open)).status).toBe(401)
    const fresh = await board.key("lead")
    expect((await board.bearer("/api/me", fresh)).status).toBe(200)
  })

  test("stopping a served agent and deleting any agent revoke its keys too", async () => {
    const board = await securedBoard()
    await board.call("simon", "POST", "/api/agents/lead/start")
    const served = await board.key("lead")
    expect((await board.call("simon", "POST", "/api/agents/lead/stop")).status).toBe(200)
    expect((await board.bearer("/api/me", served)).status).toBe(401)
    expect(await revokeCauses(board.db, "lead")).toEqual(["stop"])

    const connected = await board.key("gemini")
    expect((await board.bearer("/api/me", connected)).status).toBe(200)
    expect((await board.call("simon", "DELETE", "/api/agents/gemini")).status).toBe(200)
    expect((await board.bearer("/api/me", connected)).status).toBe(401)
    expect(await revokeCauses(board.db, "gemini")).toEqual(["delete"])
    const rows = await board.db.execute(sql`select revoked_at from member_keys where member = 'gemini'`)
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true)
  })

  test("a person revokes every key of a connected agent in one call; safe to repeat; never by a key or another org", async () => {
    const board = await securedBoard()
    const first = await board.key("claude")
    const second = await board.key("claude", ["backend"])
    const asClaude = await board.key("claude")
    const bot = await board.key("acme-bot", ["acme-site"])
    const ana = await board.key("ana")
    expect((await board.bearer("/api/members/gemini/keys/revoke", asClaude, { method: "POST" })).status).toBe(403)
    expect((await board.bearer("/api/members/claude/keys/revoke", bot, { method: "POST" })).status).toBe(403)
    expect((await board.bearer("/api/members/claude/keys/revoke", ana, { method: "POST" })).status).toBe(403)

    const once = await board.call("simon", "POST", "/api/members/claude/keys/revoke")
    expect(once.status).toBe(200)
    const revoked = RevokedKeys.parse(once.json)
    expect(revoked.revoked).toHaveLength(3)
    expect(revoked.revoked.every((k) => k.member === "claude" && k.revokedAt !== null)).toBe(true)
    for (const secret of [first, second, asClaude]) expect((await board.bearer("/api/me", secret)).status).toBe(401)
    expect((await board.bearer("/api/channels/acme-site/messages", bot)).status).toBe(200)

    const again = RevokedKeys.parse((await board.call("simon", "POST", "/api/members/claude/keys/revoke")).json)
    expect(again.revoked).toHaveLength(0)
    expect(await revokeCauses(board.db, "claude")).toEqual(["all", "all", "all"])
    expect((await board.call("simon", "POST", "/api/members/nobody/keys/revoke")).status).toBe(404)
  })
})

const mcpClient = async (app: Awaited<ReturnType<typeof securedBoard>>["secured"], headers: Record<string, string>) => {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: (input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init)),
    requestInit: { headers },
  })
  const client = new Client({ name: "governance-test", version: "1.0.0" })
  await client.connect(transport)
  return client
}

describe("access levels (11f access-levels)", () => {
  test("every operation that writes has a need, and the lists name only real operations", async () => {
    const board = await securedBoard()
    const document = z.object({ paths: z.record(z.string(), z.record(z.string(), z.object({ operationId: z.string() }))) }).parse(board.app.document())
    const ids = Object.values(document.paths).flatMap((ops) => Object.values(ops).map((op) => op.operationId))
    for (const id of classifiedOperations()) if (id !== mcpTransport) expect(ids).toContain(id)
    const match = operationMatcher(board.app.document())
    expect(match("POST", "/api/channels/backend/messages")).toBe("postMessage")
    expect(match("POST", "/api/tasks/claim")).toBe("claimNextTask")
    expect(match("POST", "/api/tasks/12/claim")).toBe("claimTask")
    expect(match("POST", "/api/members/claude/keys/revoke")).toBe("revokeMemberKeys")
    expect(needOf({ method: "GET", operationId: "listMessages" })).toBe("read")
    expect(needOf({ method: "POST", operationId: "postMessage" })).toBe("reply")
    expect(needOf({ method: "POST", operationId: "createTask" })).toBe("work")
    expect(needOf({ method: "POST", operationId: "createKey" })).toBe("manage")
    expect(needOf({ method: "POST", operationId: "somethingNew" })).toBe("manage")
    expect(needOf({ method: "POST", operationId: null })).toBe("manage")
  })

  test("a read-only agent reads everywhere it may but cannot post, reply or work, by key, by header and over MCP", async () => {
    const board = await securedBoard()
    const secret = await board.key("claude")
    const set = await board.call("simon", "PUT", "/api/agents/claude/access", { level: "read" })
    expect(set.status).toBe(200)
    expect(MemberAccess.parse(set.json)).toEqual({ name: "claude", level: "read", grants: [] })
    const task = z.object({ id: z.number() }).parse((await board.call("simon", "POST", "/api/tasks", { channel: "backend", title: "Index the users table" })).json)

    expect((await board.bearer("/api/channels/backend/messages", secret)).status).toBe(200)
    expect((await board.bearer("/api/channels/backend/read", secret, { method: "POST", body: {} })).status).not.toBe(403)
    const refused = await board.bearer("/api/channels/backend/messages", secret, { method: "POST", body: { text: "hi" } })
    expect(refused.status).toBe(403)
    expect(JSON.stringify(refused.json)).toContain("read only access")
    expect((await board.bearer(`/api/threads/${task.id}/replies`, secret, { method: "POST", body: { text: "On it" } })).status).toBe(403)
    expect((await board.bearer("/api/tasks", secret, { method: "POST", body: { channel: "backend", title: "More" } })).status).toBe(403)
    expect((await board.bearer("/api/tasks/claim", secret, { method: "POST", body: {} })).status).toBe(403)
    expect((await board.call("claude", "POST", "/api/channels/backend/messages", { text: "by header" })).status).toBe(403)
    expect((await board.call("simon", "POST", "/api/channels/backend/messages", { text: "people are not limited" })).status).toBe(200)

    const client = await mcpClient(board.secured, { authorization: `Bearer ${secret}` })
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toContain("listMessages")
    expect(names).toContain("waitForEvents")
    expect(names).not.toContain("postMessage")
    expect(names).not.toContain("claimNextTask")
    const posted = await client.callTool({ name: "postMessage", arguments: { channel: "backend", text: "sneaky" } })
    expect(posted.isError).toBe(true)
    await client.close()

    const members = z.array(z.object({ name: z.string(), access: z.string(), grants: z.array(z.string()) })).parse((await board.call("simon", "GET", "/api/members")).json)
    expect(members.find((m) => m.name === "claude")).toMatchObject({ access: "read", grants: [] })
    expect(members.find((m) => m.name === "simon")).toMatchObject({ access: "full", grants: ["reply", "work", "manage"] })
  })

  test("read and reply posts but does not work; custom gives exactly its grants; full gives everything back", async () => {
    const board = await securedBoard()
    const secret = await board.key("claude")
    await board.call("simon", "PUT", "/api/agents/claude/access", { level: "reply" })
    expect((await board.bearer("/api/channels/backend/messages", secret, { method: "POST", body: { text: "a reply" } })).status).toBe(200)
    expect((await board.bearer("/api/tasks", secret, { method: "POST", body: { channel: "backend", title: "Work" } })).status).toBe(403)

    const custom = MemberAccess.parse((await board.call("simon", "PUT", "/api/agents/claude/access", { level: "custom", grants: ["work"] })).json)
    expect(custom.grants).toEqual(["work"])
    expect((await board.bearer("/api/tasks", secret, { method: "POST", body: { channel: "backend", title: "Work" } })).status).toBe(200)
    expect((await board.bearer("/api/channels/backend/messages", secret, { method: "POST", body: { text: "no" } })).status).toBe(403)

    await board.call("simon", "PUT", "/api/agents/claude/access", { level: "full" })
    expect((await board.bearer("/api/channels/backend/messages", secret, { method: "POST", body: { text: "yes" } })).status).toBe(200)
    const changes = await board.db.execute(sql`select data from events where type = 'agent.access_changed' order by seq`)
    expect(changes.map((row) => z.object({ level: z.string() }).parse(row.data).level)).toEqual(["reply", "custom", "full"])
    expect((await board.call("simon", "PUT", "/api/agents/claude/access", { level: "full" })).status).toBe(200)
    expect(await board.db.execute(sql`select 1 from events where type = 'agent.access_changed'`)).toHaveLength(3)
  })

  test("a person acting as an agent gets the agent's level, not their own", async () => {
    const board = await securedBoard()
    const simonKey = await board.key("simon")
    await board.call("simon", "PUT", "/api/agents/claude/access", { level: "read" })
    const response = await board.secured.request("/api/channels/backend/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${simonKey}`, [memberHeader]: "claude", "content-type": "application/json" },
      body: JSON.stringify({ text: "as claude" }),
    })
    expect(response.status).toBe(403)
    expect((await board.bearer("/api/channels/backend/messages", simonKey, { method: "POST", body: { text: "as simon" } })).status).toBe(200)
  })

  test("only a host person sets access; the inputs must agree", async () => {
    const board = await securedBoard()
    expect((await board.bearer("/api/agents/codex/access", await board.key("claude"), { method: "PUT", body: { level: "read" } })).status).toBe(403)
    expect((await board.bearer("/api/agents/acme-bot/access", await board.key("ana"), { method: "PUT", body: { level: "full" } })).status).toBe(403)
    expect((await board.call("simon", "PUT", "/api/agents/claude/access", { level: "read", grants: ["reply"] })).status).toBe(400)
    expect((await board.call("simon", "PUT", "/api/agents/claude/access", { level: "custom" })).status).toBe(400)
    expect((await board.call("simon", "PUT", "/api/agents/tim/access", { level: "read" })).status).toBe(404)
    expect((await board.call("simon", "PUT", "/api/agents/acme-bot/access", { level: "read" })).status).toBe(200)
    expect((await board.bearer("/api/channels/acme-site/messages", await board.key("acme-bot", ["acme-site"]), { method: "POST", body: { text: "x" } })).status).toBe(403)
  })

  test("MCP passes the channel fence on to every tool call", async () => {
    const board = await securedBoard()
    const client = await mcpClient(board.secured, { authorization: `Bearer ${await board.key("claude")}`, [channelsHeader]: "backend" })
    expect((await client.callTool({ name: "listMessages", arguments: { channel: "backend" } })).isError).toBeFalsy()
    expect((await client.callTool({ name: "listMessages", arguments: { channel: "platform" } })).isError).toBe(true)
    await client.close()
  })
})

describe("key kinds, provisioning and rotation (11f key-kinds)", () => {
  test("a member key never manages keys, even one acting as a person", async () => {
    const board = await securedBoard()
    const simonKey = await board.key("simon")
    const target = (await createKey(board.db, "simon", { member: "claude", channels: null })).key.id
    const tries: [string, string, unknown][] = [
      ["POST", "/api/keys", { member: "claude" }],
      ["GET", "/api/keys", undefined],
      ["POST", `/api/keys/${target}/revoke`, undefined],
      ["POST", `/api/keys/${target}/rotate`, undefined],
      ["PATCH", `/api/keys/${target}`, { channels: ["backend"] }],
      ["POST", "/api/members/claude/keys/revoke", undefined],
    ]
    for (const [method, path, body] of tries) {
      const refused = await board.bearer(path, simonKey, { method, body })
      expect([path, refused.status]).toEqual([path, 403])
      expect(JSON.stringify(refused.json)).toContain("A key cannot make, list, rotate or revoke keys")
    }
    expect((await board.bearer("/api/channels/backend/messages", simonKey, { method: "POST", body: { text: "still a normal key" } })).status).toBe(200)
  })

  test("only a host person makes a provisioning key, and it acts as them", async () => {
    const board = await securedBoard()
    const made = await board.call("simon", "POST", "/api/keys", { member: "simon", kind: "provisioning" })
    expect(made.status).toBe(200)
    expect(CreatedKey.parse(made.json).key).toMatchObject({ kind: "provisioning", member: "simon", madeByKey: null })
    expect((await board.call("simon", "POST", "/api/keys", { member: "tim", kind: "provisioning" })).status).toBe(400)
    expect((await board.call("simon", "POST", "/api/keys", { member: "claude", kind: "provisioning" })).status).toBe(400)
    expect((await board.call("ana", "POST", "/api/keys", { member: "ana", kind: "provisioning" })).status).toBe(403)
    expect((await board.call("claude", "POST", "/api/keys", { member: "claude", kind: "provisioning" })).status).toBe(403)
  })

  test("a provisioning key makes, lists, rotates and revokes keys for agents only, and nothing else", async () => {
    const board = await securedBoard()
    const provisioning = CreatedKey.parse((await board.call("simon", "POST", "/api/keys", { member: "simon", kind: "provisioning" })).json)
    const other = (await createKey(board.db, "simon", { member: "codex", channels: null })).key.id
    const p = provisioning.secret

    const made = await board.bearer("/api/keys", p, { method: "POST", body: { member: "claude", channels: ["backend"] } })
    expect(made.status).toBe(200)
    const claudeKey = CreatedKey.parse(made.json)
    expect(claudeKey.key).toMatchObject({ member: "claude", kind: "member", madeByKey: provisioning.key.id, createdBy: "simon", channels: ["backend"] })
    expect((await board.bearer("/api/channels/backend/messages", claudeKey.secret)).status).toBe(200)
    expect((await board.bearer("/api/keys", p, { method: "POST", body: { member: "acme-bot", channels: ["acme-site"] } })).status).toBe(200)

    expect((await board.bearer("/api/keys", p, { method: "POST", body: { member: "tim" } })).status).toBe(403)
    expect((await board.bearer("/api/keys", p, { method: "POST", body: { member: "simon", kind: "provisioning" } })).status).toBe(403)
    const listed = z.array(MemberKey).parse((await board.bearer("/api/keys", p)).json)
    expect(listed.map((k) => k.member).sort()).toEqual(["acme-bot", "claude"])
    expect((await board.bearer(`/api/keys/${other}/revoke`, p, { method: "POST" })).status).toBe(404)
    expect((await board.bearer(`/api/keys/${other}/rotate`, p, { method: "POST" })).status).toBe(404)
    expect((await board.bearer("/api/members/claude/keys/revoke", p, { method: "POST" })).status).toBe(403)

    expect((await board.bearer("/api/me", p)).status).toBe(200)
    expect((await board.bearer("/api/channels/backend/messages", p)).status).toBe(403)
    expect((await board.bearer("/api/channels/backend/messages", p, { method: "POST", body: { text: "no" } })).status).toBe(403)
    expect((await board.bearer("/api/agents/claude/pause", p, { method: "POST" })).status).toBe(403)
    expect((await board.bearer("/mcp", p, { method: "POST", body: {} })).status).toBe(403)
    expect(await liveViewer(board.secured.authenticator, { headers: new Headers({ authorization: `Bearer ${p}` }), url: liveUrl })).toMatchObject({ status: 403 })

    expect((await board.bearer(`/api/keys/${claudeKey.key.id}/revoke`, p, { method: "POST" })).status).toBe(200)
    expect((await board.bearer("/api/channels/backend/messages", claudeKey.secret)).status).toBe(401)
  })

  test("a channel-limited provisioning key makes only narrower keys", async () => {
    const board = await securedBoard()
    const p = CreatedKey.parse((await board.call("simon", "POST", "/api/keys", { member: "simon", kind: "provisioning", channels: ["backend", "platform"] })).json).secret
    const inherited = CreatedKey.parse((await board.bearer("/api/keys", p, { method: "POST", body: { member: "claude" } })).json)
    expect(inherited.key.channels).toEqual(["backend", "platform"])
    expect((await board.bearer("/api/keys", p, { method: "POST", body: { member: "claude", channels: ["backend"] } })).status).toBe(200)
    expect((await board.bearer("/api/keys", p, { method: "POST", body: { member: "claude", channels: ["reviews"] } })).status).toBe(403)
    expect((await board.bearer(`/api/keys/${inherited.key.id}`, p, { method: "PATCH", body: { channels: null } })).status).toBe(403)
    expect((await board.bearer(`/api/keys/${inherited.key.id}`, p, { method: "PATCH", body: { channels: ["reviews"] } })).status).toBe(403)
    const narrowed = await board.bearer(`/api/keys/${inherited.key.id}`, p, { method: "PATCH", body: { channels: ["backend"] } })
    expect(MemberKey.parse(narrowed.json)).toMatchObject({ id: inherited.key.id, channels: ["backend"] })
  })

  test("rotation keeps the id and channels, refuses the old secret at once and cuts its live feed", async () => {
    const board = await securedBoard()
    const first = await createKey(board.db, "simon", { member: "claude", channels: ["backend"] })
    const before = await liveViewer(board.secured.authenticator, { headers: new Headers({ authorization: `Bearer ${first.secret}` }), url: liveUrl })
    if (before instanceof Response) throw new Error("the key should open a live feed")
    expect(await stillLive(board.db, before)).toBe(true)

    const rotated = CreatedKey.parse((await board.call("simon", "POST", `/api/keys/${first.key.id}/rotate`)).json)
    expect(rotated.key).toMatchObject({ id: first.key.id, member: "claude", channels: ["backend"], revokedAt: null })
    expect(rotated.key.rotatedAt).not.toBeNull()
    expect(rotated.secret).not.toBe(first.secret)
    expect((await board.bearer("/api/me", first.secret)).status).toBe(401)
    expect((await board.bearer("/api/me", rotated.secret)).status).toBe(200)
    expect(await stillLive(board.db, before)).toBe(false)

    const after = await liveViewer(board.secured.authenticator, { headers: new Headers({ authorization: `Bearer ${rotated.secret}` }), url: liveUrl })
    if (after instanceof Response) throw new Error("the new secret should open a live feed")
    const rescoped = MemberKey.parse((await board.call("simon", "PATCH", `/api/keys/${first.key.id}`, { channels: ["backend", "platform"] })).json)
    expect(rescoped).toMatchObject({ id: first.key.id, channels: ["backend", "platform"] })
    expect((await board.bearer("/api/channels/platform/messages", rotated.secret)).status).toBe(200)
    expect(await stillLive(board.db, after)).toBe(false)
    expect((await board.call("simon", "PATCH", `/api/keys/${first.key.id}`, { channels: ["backend", "platform"] })).status).toBe(200)

    await board.call("simon", "POST", `/api/keys/${first.key.id}/revoke`)
    expect((await board.call("simon", "POST", `/api/keys/${first.key.id}/rotate`)).status).toBe(409)
    const types = await board.db.execute(sql`select type from events where type like 'key.%' order by seq`)
    expect(types.map((row) => row.type)).toEqual(["key.created", "key.rotated", "key.rescoped", "key.revoked"])
  })
})

const pkce = async () => {
  const verifier = `verifier-${crypto.randomUUID()}-${crypto.randomUUID()}`
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return { verifier, challenge }
}

const Registered = z.object({ client_id: z.string() })
const TokenOk = z.object({ access_token: z.string(), token_type: z.literal("Bearer") })
const TokenError = z.object({ error: z.string() })
const DeviceStart = z.object({ device_code: z.string(), user_code: z.string(), verification_uri: z.string(), interval: z.number() })

async function form(app: Awaited<ReturnType<typeof securedBoard>>["secured"], path: string, fields: Record<string, string>) {
  const response = await app.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() })
  const text = await response.text()
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : null }
}

async function registerClient(app: Awaited<ReturnType<typeof securedBoard>>["secured"], body: Record<string, unknown>) {
  const response = await app.request("/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return { status: response.status, json: (await response.json()) as unknown }
}

describe("OAuth for MCP (11f mcp-oauth)", () => {
  test("discovery: the metadata documents, and a 401 from /mcp that points at them", async () => {
    const board = await securedBoard()
    const resource = z.object({ resource: z.string(), authorization_servers: z.array(z.string()) }).parse(await (await board.secured.request("/.well-known/oauth-protected-resource/mcp")).json())
    expect(resource).toMatchObject({ resource: "http://localhost/mcp", authorization_servers: ["http://localhost"] })
    const server = z.record(z.string(), z.unknown()).parse(await (await board.secured.request("/.well-known/oauth-authorization-server")).json())
    expect(server).toMatchObject({
      issuer: "http://localhost",
      authorization_endpoint: "http://localhost/oauth/authorize",
      token_endpoint: "http://localhost/api/oauth/token",
      registration_endpoint: "http://localhost/api/oauth/register",
      device_authorization_endpoint: "http://localhost/api/oauth/device",
      code_challenge_methods_supported: ["S256"],
    })
    const refused = await board.secured.request("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toBe('Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"')
    expect((await board.app.request("/.well-known/oauth-authorization-server")).status).toBe(404)
  })

  test("Claude Code style: register, consent as an agent I own, exchange the code with PKCE, then MCP posts as that agent", async () => {
    const board = await securedBoard()
    const redirect = "http://localhost:52811/callback"
    expect((await registerClient(board.secured, { client_name: "Evil", redirect_uris: ["http://evil.example/cb"] })).status).toBe(400)
    expect((await registerClient(board.secured, { client_name: "Evil", redirect_uris: ["javascript:alert(1)"] })).status).toBe(400)
    const registered = await registerClient(board.secured, { client_name: "Claude Code", redirect_uris: [redirect] })
    expect(registered.status).toBe(201)
    const client = Registered.parse(registered.json).client_id
    const cookie = await board.signIn("simon@example.com")
    expect(OAuthClient.parse((await board.session(`/api/oauth/clients/${client}`, cookie)).json).name).toBe("Claude Code")

    const { verifier, challenge } = await pkce()
    const ask = { clientId: client, redirectUri: redirect, codeChallenge: challenge, codeChallengeMethod: "S256", state: "xyz" }
    expect((await board.session("/api/oauth/authorize", cookie, { method: "POST", body: { ...ask, redirectUri: "http://localhost:1/other", decision: "allow" } })).status).toBe(400)
    expect((await board.session("/api/oauth/authorize", cookie, { method: "POST", body: { ...ask, decision: "allow", act: "agent", agent: "gemini" } })).status).toBe(403)
    const denied = new URL(AuthorizeResult.parse((await board.session("/api/oauth/authorize", cookie, { method: "POST", body: { ...ask, decision: "deny" } })).json).redirect)
    expect([denied.searchParams.get("error"), denied.searchParams.get("state")]).toEqual(["access_denied", "xyz"])
    expect((await board.bearer("/api/oauth/authorize", await board.key("simon"), { method: "POST", body: { ...ask, decision: "allow" } })).status).toBe(403)

    const allowed = await board.session("/api/oauth/authorize", cookie, { method: "POST", body: { ...ask, decision: "allow", act: "agent", agent: "claude" } })
    expect(allowed.status).toBe(200)
    const back = new URL(AuthorizeResult.parse(allowed.json).redirect)
    expect(`${back.origin}${back.pathname}`).toBe(redirect)
    expect(back.searchParams.get("state")).toBe("xyz")
    const code = back.searchParams.get("code") ?? ""
    const exchange = { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: client, code_verifier: verifier }
    expect(TokenError.parse((await form(board.secured, "/api/oauth/token", { ...exchange, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier" })).json).error).toBe("invalid_grant")
    const issued = await form(board.secured, "/api/oauth/token", exchange)
    expect(issued.status).toBe(200)
    const token = TokenOk.parse(issued.json).access_token
    expect(TokenError.parse((await form(board.secured, "/api/oauth/token", exchange)).json).error).toBe("invalid_grant")

    const mcp = await mcpClient(board.secured, { authorization: `Bearer ${token}` })
    const me = z.object({ name: z.string(), via: z.string() }).parse((await mcp.callTool({ name: "whoami", arguments: {} })).structuredContent)
    expect(me).toEqual(expect.objectContaining({ name: "claude", via: "key" }))
    const posted = await mcp.callTool({ name: "postMessage", arguments: { channel: "backend", text: "Connected over OAuth", who: "simon" } })
    expect(JSON.stringify(posted.structuredContent)).toContain('"who":"claude"')
    await mcp.close()
    const keys = z.array(MemberKey).parse((await board.call("simon", "GET", "/api/keys")).json)
    expect(keys.find((k) => k.client === "Claude Code")).toMatchObject({ member: "claude", kind: "member", createdBy: "simon" })
    expect((await board.bearer("/api/keys", token, { method: "POST", body: { member: "claude" } })).status).toBe(403)

    await board.call("simon", "PUT", "/api/agents/claude/access", { level: "read" })
    const limited = await mcpClient(board.secured, { authorization: `Bearer ${token}` })
    expect((await limited.listTools()).tools.map((t) => t.name)).not.toContain("postMessage")
    await limited.close()

    expect((await form(board.secured, "/api/oauth/revoke", { token, client_id: client })).status).toBe(200)
    expect((await board.bearer("/api/me", token)).status).toBe(401)
  })

  test("device flow: a client person connects their own agent, limited to the shared channel; nothing crosses orgs", async () => {
    const board = await securedBoard()
    const client = Registered.parse((await registerClient(board.secured, { client_name: "Codex", grant_types: ["urn:ietf:params:oauth:grant-type:device_code"] })).json).client_id
    const start = DeviceStart.parse((await form(board.secured, "/api/oauth/device", { client_id: client, scope: "board" })).json)
    expect(start.verification_uri).toBe("http://localhost/oauth/device")
    expect(start.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/)
    const poll = () => form(board.secured, "/api/oauth/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: client })
    expect(TokenError.parse((await poll()).json).error).toBe("authorization_pending")

    const ana = await board.signIn("ana@example.com")
    const typed = start.user_code.toLowerCase().replace("-", "")
    expect(DeviceRequest.parse((await board.session(`/api/oauth/device/${typed}`, ana)).json).client.name).toBe("Codex")
    expect((await board.session(`/api/oauth/device/${typed}`, ana, { method: "POST", body: { decision: "allow", act: "agent", agent: "claude" } })).status).toBe(403)
    expect((await board.session(`/api/oauth/device/${typed}`, ana, { method: "POST", body: { decision: "allow", act: "agent", newAgent: "acme-two" } })).status).toBe(403)
    expect((await board.session(`/api/oauth/device/${typed}`, ana, { method: "POST", body: { decision: "allow", act: "agent", agent: "acme-bot", channels: ["backend"] } })).status).toBe(400)
    const decided = await board.session(`/api/oauth/device/${typed}`, ana, { method: "POST", body: { decision: "allow", act: "agent", agent: "acme-bot", channels: ["acme-site"] } })
    expect(DeviceDecision.parse(decided.json)).toEqual({ status: "approved", member: "acme-bot" })
    expect((await board.session(`/api/oauth/device/${typed}`, ana, { method: "POST", body: { decision: "deny" } })).status).toBe(404)

    const token = TokenOk.parse((await poll()).json).access_token
    expect(TokenError.parse((await poll()).json).error).toBe("invalid_grant")
    expect((await board.bearer("/api/channels/acme-site/messages", token)).status).toBe(200)
    expect((await board.bearer("/api/channels/backend/messages", token)).status).toBe(403)
    const channels = z.array(z.object({ id: z.string() })).parse((await board.bearer("/api/channels", token)).json)
    expect(channels.map((c) => c.id)).toEqual(["acme-site"])
    expect((await board.call("simon", "POST", "/api/members/acme-bot/keys/revoke")).status).toBe(200)
    expect((await board.bearer("/api/me", token)).status).toBe(401)

    const second = DeviceStart.parse((await form(board.secured, "/api/oauth/device", { client_id: client })).json)
    await board.session(`/api/oauth/device/${second.user_code}`, ana, { method: "POST", body: { decision: "deny" } })
    expect(TokenError.parse((await form(board.secured, "/api/oauth/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: second.device_code, client_id: client })).json).error).toBe("access_denied")
    expect(TokenError.parse((await form(board.secured, "/api/oauth/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: second.device_code, client_id: "oc_unknown" })).json).error).toBe("invalid_client")
  })

  test("a host person can connect as a new agent they own, made at the consent click", async () => {
    const board = await securedBoard()
    const client = Registered.parse((await registerClient(board.secured, { client_name: "Grok", redirect_uris: ["https://grok.example/oauth/callback"] })).json).client_id
    const cookie = await board.signIn("simon@example.com")
    const { verifier, challenge } = await pkce()
    const allowed = await board.session("/api/oauth/authorize", cookie, {
      method: "POST",
      body: { clientId: client, redirectUri: "https://grok.example/oauth/callback", codeChallenge: challenge, codeChallengeMethod: "S256", decision: "allow", act: "agent", newAgent: "grok-helper" },
    })
    const code = new URL(AuthorizeResult.parse(allowed.json).redirect).searchParams.get("code") ?? ""
    const token = TokenOk.parse((await form(board.secured, "/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: "https://grok.example/oauth/callback", client_id: client, code_verifier: verifier })).json).access_token
    const me = z.object({ name: z.string(), member: z.object({ kind: z.string(), owner: z.string().nullable() }) }).parse((await board.bearer("/api/me", token)).json)
    expect(me).toMatchObject({ name: "grok-helper", member: { kind: "agent", owner: "simon" } })
  })
})
