import { describe, expect, test } from "bun:test"
import { RevokedKeys } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { liveViewer } from "../src/auth/identity"
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
