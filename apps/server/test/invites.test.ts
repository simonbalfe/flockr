import { describe, expect, test } from "bun:test"
import { CreatedKey, Invite, Member } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { createApp } from "../src/app"
import { createKey } from "../src/board/keys"
import { logEmail } from "../src/email/log"
import { resetBoard, seedBoard } from "../src/seed/seed"
import { testConnection } from "./harness"

const origin = "http://localhost"
const Me = z.object({ name: z.string(), member: Member.nullable() })

async function inviteBoard() {
  const connection = await testConnection()
  await resetBoard(connection.db)
  await seedBoard(connection.db)
  const mail: string[] = []
  const people = new Map([["simon@example.com", "simon"]])
  const app = createApp(connection.db, { auth: { mode: "on", people, secret: "test-secret-for-the-invite-tests-only", baseURL: origin, email: logEmail((line) => mail.push(line)) } })
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
  const signIn = async (email: string): Promise<string | null> => {
    const before = mail.length
    await call("/api/auth/sign-in/magic-link", { method: "POST", body: { email, callbackURL: "/" } })
    const url = /http\S+\/magic-link\/verify\S+/.exec(mail.slice(before).join("\n"))?.[0]
    if (!url) return null
    const link = new URL(url)
    const visit = await call(`${link.pathname}${link.search}`)
    const cookie = visit.response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
    return cookie.includes("session") ? cookie : null
  }
  const as = (cookie: string) => ({ cookie })
  await connection.db.execute(sql`insert into orgs (id, name, host) values ('acme', 'Acme', false) on conflict do nothing`)
  return { db: connection.db, mail, call, signIn, as }
}

describe("invites and profiles (11c)", () => {
  test("an invited address signs in with the one-time link and becomes a person in the client org", async () => {
    const board = await inviteBoard()
    const simon = await board.signIn("simon@example.com")
    if (!simon) throw new Error("simon could not sign in")
    const invite = Invite.parse((await board.call("/api/invites", { method: "POST", headers: board.as(simon), body: { email: "Ana@Acme.example", name: "ana", org: "acme" } })).json)
    expect(invite).toMatchObject({ email: "ana@acme.example", name: "ana", org: "acme", state: "open", invitedBy: "simon" })
    expect(board.mail.join("\n")).toContain("simon invited you to Flockr as ana")
    const ana = await board.signIn("ana@acme.example")
    if (!ana) throw new Error("ana could not sign in")
    const me = Me.parse((await board.call("/api/me", { headers: board.as(ana) })).json)
    expect(me).toMatchObject({ name: "ana", member: { kind: "person", org: "acme" } })
    const again = await board.signIn("ana@acme.example")
    expect(Me.parse((await board.call("/api/me", { headers: board.as(again ?? "") })).json).name).toBe("ana")
    const list = z.array(Invite).parse((await board.call("/api/invites", { headers: board.as(simon) })).json)
    expect(list[0]?.state).toBe("accepted")
    expect((await board.call("/api/channels/backend/messages", { headers: board.as(ana) })).status).toBe(403)
  })

  test("only a signed-in host person invites: never a key, never a client person; taken names and addresses are refused", async () => {
    const board = await inviteBoard()
    const simon = await board.signIn("simon@example.com")
    if (!simon) throw new Error("simon could not sign in")
    const key = CreatedKey.parse(await createKey(board.db, "simon", { member: "simon", channels: null })).secret
    const body = { email: "ana@acme.example", name: "ana", org: "acme" }
    expect((await board.call("/api/invites", { method: "POST", headers: { authorization: `Bearer ${key}` }, body })).status).toBe(403)
    expect((await board.call("/api/invites", { method: "POST", headers: board.as(simon), body })).status).toBe(200)
    const ana = await board.signIn("ana@acme.example")
    if (!ana) throw new Error("ana could not sign in")
    expect((await board.call("/api/invites", { method: "POST", headers: board.as(ana), body: { email: "bo@acme.example", name: "bo", org: "acme" } })).status).toBe(403)
    expect((await board.call("/api/invites", { method: "POST", headers: board.as(simon), body: { email: "simon@example.com", name: "simon2", org: "acme" } })).status).toBe(400)
    expect((await board.call("/api/invites", { method: "POST", headers: board.as(simon), body: { email: "bo@acme.example", name: "claude", org: "acme" } })).status).toBe(400)
  })

  test("a revoked or expired invite lets nobody in", async () => {
    const board = await inviteBoard()
    const simon = await board.signIn("simon@example.com")
    if (!simon) throw new Error("simon could not sign in")
    const invite = Invite.parse((await board.call("/api/invites", { method: "POST", headers: board.as(simon), body: { email: "bo@acme.example", name: "bo", org: "acme" } })).json)
    expect((await board.call(`/api/invites/${invite.id}/revoke`, { method: "POST", headers: board.as(simon) })).status).toBe(200)
    expect(await board.signIn("bo@acme.example")).toBeNull()
    await board.call("/api/invites", { method: "POST", headers: board.as(simon), body: { email: "cy@acme.example", name: "cy", org: "acme" } })
    await board.db.execute(sql`update invites set expires_at = now() - interval '1 minute' where email = 'cy@acme.example'`)
    expect(await board.signIn("cy@acme.example")).toBeNull()
  })

  test("profiles: the owner sets an agent's display name, a stranger cannot, colours come from the list", async () => {
    const board = await inviteBoard()
    const simon = await board.signIn("simon@example.com")
    if (!simon) throw new Error("simon could not sign in")
    const set = Member.parse((await board.call("/api/members/claude/profile", { method: "PATCH", headers: board.as(simon), body: { displayName: "Claude (builder)", about: "Builds the API", colour: "blue" } })).json)
    expect(set).toMatchObject({ displayName: "Claude (builder)", about: "Builds the API", colour: "blue" })
    const gemini = CreatedKey.parse(await createKey(board.db, "simon", { member: "gemini", channels: null })).secret
    expect((await board.call("/api/members/claude/profile", { method: "PATCH", headers: { authorization: `Bearer ${gemini}` }, body: { about: "mine now" } })).status).toBe(403)
    expect((await board.call("/api/members/gemini/profile", { method: "PATCH", headers: { authorization: `Bearer ${gemini}` }, body: { displayName: "Gemini" } })).status).toBe(200)
    expect((await board.call("/api/members/claude/profile", { method: "PATCH", headers: board.as(simon), body: { colour: "neon" } })).status).toBe(400)
  })
})
